/**
 * Lambda: on-media-format
 *
 * Triggered by S3 ObjectCreated:* on the raw.polls.pizza bucket.
 *
 * Routes based on content type:
 *   Image path: resizes with sharp, outputs WebP + JPEG to reports.polls.pizza.
 *   Video path: kicks off AWS MediaConvert job (H.264/AAC MP4, max 1080p).
 *
 * Updates DB: media_status = 'ready' (or 'failed'), processed_file_path.
 * All metadata is stripped by sharp during re-encode.
 */

import { S3, MediaConvert } from "aws-sdk";
import { initializeDataSource } from "../data-source";
import { Upload } from "../entity/Upload";
import * as path from "path";

const s3 = new S3({ region: process.env.AWS_REGION || "us-west-2" });

const PROCESSED_BUCKET = process.env.UPLOAD_S3_BUCKET || "reports.polls.pizza";
const RAW_BUCKET = process.env.RAW_UPLOADS_BUCKET || "raw.polls.pizza";

const IMAGE_MAX_DIMENSION = parseInt(
  process.env.IMAGE_MAX_DIMENSION || "1920",
  10
);
const IMAGE_QUALITY = parseInt(process.env.IMAGE_QUALITY || "85", 10);

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "heic",
  "heif",
]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm"]);

let mediaConvertEndpoint: string | null = null;

interface S3EventRecord {
  s3: {
    bucket: { name: string };
    object: { key: string; size: number };
  };
}

interface S3Event {
  Records: S3EventRecord[];
}

export async function handler(event: S3Event): Promise<void> {
  await initializeDataSource();

  for (const record of event.Records) {
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

    console.log(`[on-media-format] s3://${record.s3.bucket.name}/${key}`);

    const fileExt = key.split(".").pop()?.toLowerCase() || "";

    // Find the upload by raw_file_path
    const upload = await Upload.findOne({ where: { rawFilePath: key } as any });
    if (!upload) {
      console.log(
        `[on-media-format] No upload record for ${key} — may not be submitted yet`
      );
      continue;
    }

    try {
      upload.mediaStatus = "processing";
      await upload.save();

      if (IMAGE_EXTENSIONS.has(fileExt)) {
        const result = await processImage(key, upload.id);
        upload.processedFilePath = result;
        // file_path → primary processed output (webp for images)
        if (result.webp) {
          upload.filePath = result.webp.replace(
            `https://${PROCESSED_BUCKET}.s3.amazonaws.com/`,
            ""
          );
        }
        upload.mediaStatus = "ready";
        await upload.save();
        console.log(
          `[on-media-format] Image ${key} processed:`,
          JSON.stringify(result)
        );
      } else if (VIDEO_EXTENSIONS.has(fileExt)) {
        await transcodeVideo(key, upload.id);
        // MediaConvert is async — on-mediaconvert-complete will update status
        console.log(`[on-media-format] MediaConvert job started for ${key}`);
      } else {
        console.warn(
          `[on-media-format] Unknown extension: ${fileExt} for ${key}`
        );
        upload.mediaStatus = "failed";
        await upload.save();
      }
    } catch (err) {
      console.error(`[on-media-format] Failed for ${key}:`, err);
      try {
        upload.mediaStatus = "failed";
        await upload.save();
      } catch {
        // DB update failed too — nothing we can do
      }
    }
  }
}

// ── Image processing (sharp) ──────────────────────────────

async function processImage(
  key: string,
  uploadId: number
): Promise<Record<string, string>> {
  // sharp is provided via Lambda layer
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sharp = require("sharp");

  const s3Object = await s3
    .getObject({ Bucket: RAW_BUCKET, Key: key })
    .promise();

  if (!s3Object.Body) {
    throw new Error(`Empty body for ${key}`);
  }

  const buffer = Buffer.isBuffer(s3Object.Body)
    ? s3Object.Body
    : Buffer.from(s3Object.Body as ArrayBuffer);

  const ext = path.extname(key).toLowerCase();
  const image = sharp(buffer, {
    failOnError: false,
    animated: ext === ".gif",
  });

  const metadata = await image.metadata();
  const longestEdge = Math.max(metadata.width || 0, metadata.height || 0);
  const needsResize = longestEdge > IMAGE_MAX_DIMENSION;

  const prefix = `uploads/${uploadId}`;
  const processedPath: Record<string, string> = {};

  if (metadata.format === "gif") {
    // Animated GIF: preserve animation, resize if needed
    const resized = needsResize
      ? await sharp(buffer, { animated: true })
          .resize({
            width: IMAGE_MAX_DIMENSION,
            height: IMAGE_MAX_DIMENSION,
            fit: "inside",
            withoutEnlargement: true,
          })
          .toBuffer()
      : buffer;

    const gifKey = `${prefix}.gif`;
    await s3
      .putObject({
        Bucket: PROCESSED_BUCKET,
        Key: gifKey,
        Body: resized,
        ContentType: "image/gif",
        ACL: "public-read",
      })
      .promise();

    processedPath.gif = `https://${PROCESSED_BUCKET}.s3.amazonaws.com/${gifKey}`;
    return processedPath;
  }

  // Build resize pipeline if needed
  const resizePipeline = needsResize
    ? image.resize({
        width: IMAGE_MAX_DIMENSION,
        height: IMAGE_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
    : image;

  // WebP (primary)
  const webpBuffer = await resizePipeline
    .clone()
    .webp({ quality: IMAGE_QUALITY })
    .toBuffer();

  const webpKey = `${prefix}.webp`;
  await s3
    .putObject({
      Bucket: PROCESSED_BUCKET,
      Key: webpKey,
      Body: webpBuffer,
      ContentType: "image/webp",
      ACL: "public-read",
    })
    .promise();

  processedPath.webp = `https://${PROCESSED_BUCKET}.s3.amazonaws.com/${webpKey}`;

  // JPEG (fallback)
  const jpegBuffer = await resizePipeline
    .clone()
    .jpeg({ quality: IMAGE_QUALITY })
    .toBuffer();

  const jpegKey = `${prefix}.jpeg`;
  await s3
    .putObject({
      Bucket: PROCESSED_BUCKET,
      Key: jpegKey,
      Body: jpegBuffer,
      ContentType: "image/jpeg",
      ACL: "public-read",
    })
    .promise();

  processedPath.jpeg = `https://${PROCESSED_BUCKET}.s3.amazonaws.com/${jpegKey}`;

  return processedPath;
}

// ── Video transcoding (AWS MediaConvert) ──────────────────

async function transcodeVideo(key: string, uploadId: number): Promise<void> {
  if (!mediaConvertEndpoint) {
    const mc = new MediaConvert({
      region: process.env.AWS_REGION || "us-west-2",
    });
    const data = await mc.describeEndpoints().promise();
    mediaConvertEndpoint = data.Endpoints?.[0]?.Url || "";
    if (!mediaConvertEndpoint) {
      throw new Error("MediaConvert: no endpoints available");
    }
  }

  const mediaConvert = new MediaConvert({
    region: process.env.AWS_REGION || "us-west-2",
    endpoint: mediaConvertEndpoint,
  });

  const outputPrefix = `uploads/${uploadId}`;

  // Store job ID on the upload so on-mediaconvert-complete can find it
  const upload = await Upload.findOne({ where: { id: uploadId } as any });
  if (!upload) return;

  const jobParams: MediaConvert.Types.CreateJobRequest = {
    Role: process.env.MEDIACONVERT_ROLE_ARN || "",
    Settings: {
      Inputs: [
        {
          FileInput: `s3://${RAW_BUCKET}/${key}`,
          AudioSelectors: {
            "Audio Selector 1": {
              DefaultSelection: "DEFAULT",
            },
          },
        },
      ],
      OutputGroups: [
        {
          OutputGroupSettings: {
            Type: "FILE_GROUP_SETTINGS",
            FileGroupSettings: {
              Destination: `s3://${PROCESSED_BUCKET}/${outputPrefix}/`,
            },
          },
          Outputs: [
            {
              ContainerSettings: { Container: "MP4" },
              VideoDescription: {
                CodecSettings: {
                  Codec: "H_264",
                  H264Settings: {
                    MaxBitrate: 5_000_000,
                    RateControlMode: "QVBR",
                    QualityTuningLevel: "SINGLE_PASS",
                  },
                },
                Width: 1920,
                Height: 1080,
                RespondToAfd: "NONE",
                ScalingBehavior: "DEFAULT",
              },
              AudioDescriptions: [
                {
                  CodecSettings: {
                    Codec: "AAC",
                    AacSettings: {
                      Bitrate: 128000,
                      CodingMode: "CODING_MODE_2_0",
                    },
                  },
                },
              ],
              NameModifier: "_transcoded",
            },
          ],
        },
      ],
    },
    UserMetadata: {
      uploadId: String(uploadId),
      sourceKey: key,
    },
  };

  const job = await mediaConvert.createJob(jobParams).promise();

  // Store the job ID so on-mediaconvert-complete can match it
  upload.processedFilePath = { jobId: job.Job?.Id || "" };
  await upload.save();

  console.log(
    `[on-media-format] MediaConvert job ${job.Job?.Id} started for upload ${uploadId}`
  );
}
