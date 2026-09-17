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

const PROCESSED_BUCKET = process.env.UPLOAD_S3_BUCKET || "reports.polls.pizza";

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

  if (status === "COMPLETE") {
    // Build MP4 URL from output paths
    const outputs = outputGroupDetails?.[0]?.outputDetails || [];
    const mp4Path = outputs[0]?.outputFilePaths?.[0];

    if (mp4Path) {
      // MediaConvert outputs full S3 paths like s3://bucket/key_transcoded.mp4
      const key = mp4Path.replace(`s3://${PROCESSED_BUCKET}/`, "");
      const mp4Url = `https://s3.us-west-2.amazonaws.com/${PROCESSED_BUCKET}/${key}`;
      // Keep jobId so redelivered events still resolve.
      upload.processedFilePath = { mp4: mp4Url, jobId };
      console.log(
        `[on-mediaconvert-complete] Upload ${upload.id} ready: ${mp4Url}`,
      );
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
