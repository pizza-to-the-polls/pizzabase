/**
 * Lambda: on-mediaconvert-complete
 *
 * Triggered by EventBridge when a MediaConvert job changes state
 * (COMPLETE or ERROR).
 *
 * Finds the Upload by job ID (stored in processed_file_path.jobId by
 * on-media-format), builds the MP4 output URL, and updates:
 *   media_status = 'ready' | 'failed'
 *   processed_file_path = { mp4: "https://..." }
 */

import { initializeDataSource } from "../data-source";
import { Upload } from "../entity/Upload";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { cdnUrlForKey } from "../lib/media-cdn";
import { zapNewUpload } from "../lib/zapier";

const PROCESSED_BUCKET = process.env.UPLOAD_S3_BUCKET || "reports.polls.pizza";
const s3 = new S3Client({ region: process.env.AWS_REGION || "us-west-2" });

interface MediaConvertDetail {
  status: "COMPLETE" | "ERROR" | "CANCELED";
  jobId: string;
  userMetadata?: Record<string, string>;
  outputGroupDetails?: {
    outputDetails: {
      outputFilePaths: string[];
    }[];
  }[];
}

interface EventBridgeEvent {
  detail: MediaConvertDetail;
}

export async function handler(event: EventBridgeEvent): Promise<void> {
  const { status, jobId, userMetadata, outputGroupDetails } = event.detail;

  console.log(`[on-mediaconvert-complete] Job ${jobId} status: ${status}`);

  if (status !== "COMPLETE" && status !== "ERROR") {
    return; // Only handle terminal states
  }

  await initializeDataSource();

  // Preferred: resolve by primary key from the job's UserMetadata (set at
  // CreateJob time) — no JSONB operator needed.
  const uploadIdFromMeta = parseInt(userMetadata?.uploadId || "", 10);
  let upload = Number.isFinite(uploadIdFromMeta)
    ? await Upload.findOne({ where: { id: uploadIdFromMeta } as any })
    : null;

  if (!upload) {
    // Fallback: find by job ID via jsonb query (jobs created without
    // UserMetadata). NOTE: the Aurora Data API driver may store JSONB params
    // as string-wrapped JSON, which makes the ->> extraction return NULL —
    // if this path logs "No upload found" for a job that HAS UserMetadata,
    // the metadata path above is the reliable one.
    upload = await Upload.createQueryBuilder("u")
      .where("u.processed_file_path ->> 'jobId' = :jobId", { jobId })
      .getOne();
  }

  if (!upload) {
    console.warn(`[on-mediaconvert-complete] No upload found for job ${jobId}`);
    return;
  }

  // Event invocations can be redelivered — the feed zap fires only on the
  // transition into "ready" (first completion), never on re-processing.
  const firstCompletion = upload.mediaStatus !== "ready";

  if (status === "COMPLETE") {
    // Build MP4 URL from output paths
    const outputs = outputGroupDetails?.[0]?.outputDetails || [];
    const mp4Path = outputs[0]?.outputFilePaths?.[0];

    if (mp4Path) {
      // MediaConvert outputs full S3 paths like s3://bucket/key_transcoded.mp4
      const key = mp4Path.replace(`s3://${PROCESSED_BUCKET}/`, "");

      // MediaConvert writes ftyp major brand "M4V " into its MP4 outputs;
      // BlueSky's blob sniffer maps that brand to video/x-m4v and rejects the
      // post ("Expected video/mp4"). Patch the brand to "isom" (already in
      // the file's compatible-brands list) so sniffers see a canonical MP4.
      try {
        await normalizeMp4Brand(key);
      } catch (err) {
        console.error(
          `[on-mediaconvert-complete] ftyp normalization failed for ${key}:`,
          err,
        );
      }

      const mp4Url =
        cdnUrlForKey(key) ??
        `https://s3.us-west-2.amazonaws.com/${PROCESSED_BUCKET}/${key}`;
      // Keep jobId so redelivered events still resolve.
      upload.processedFilePath = { mp4: mp4Url, jobId };
      console.log(
        `[on-mediaconvert-complete] Upload ${upload.id} ready: ${mp4Url}`,
      );
      // Feed zap fires HERE, not at upload creation: media exists, and the
      // payload's permalink resolves to the transcoded output.
      if (firstCompletion) {
        await zapNewUpload(upload);
      }
    } else {
      console.warn(
        `[on-mediaconvert-complete] No output paths for job ${jobId}`,
      );
    }

    upload.mediaStatus = "ready";
  } else {
    upload.mediaStatus = "failed";
    console.warn(
      `[on-mediaconvert-complete] Upload ${upload.id} transcoding failed`,
    );
  }

  await upload.save();
}

/**
 * Rewrite the ftyp major brand of a MediaConvert MP4 from "M4V " to "isom"
 * (same 4-byte length, and "isom" is already listed in compatible brands),
 * then put the object back with a canonical content type.
 */
export async function normalizeMp4Brand(key: string): Promise<void> {
  const obj = await s3.send(
    new GetObjectCommand({ Bucket: PROCESSED_BUCKET, Key: key }),
  );
  if (!obj.Body) throw new Error("Empty body");
  const buffer = Buffer.from(await obj.Body.transformToByteArray());

  // ISO BMFF: bytes 4-8 are "ftyp", bytes 8-12 the major brand
  const isFtyp =
    buffer.length >= 12 && buffer.toString("latin1", 4, 8) === "ftyp";
  const brand = buffer.toString("latin1", 8, 12);

  if (isFtyp && brand === "M4V ") {
    buffer.write("isom", 8, "latin1");
    await s3.send(
      new PutObjectCommand({
        Bucket: PROCESSED_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: "video/mp4",
      }),
    );
    console.log(
      `[on-mediaconvert-complete] Patched ftyp brand M4V → isom for ${key}`,
    );
  } else {
    console.log(
      `[on-mediaconvert-complete] No brand patch needed for ${key} (brand: ${brand})`,
    );
  }
}
