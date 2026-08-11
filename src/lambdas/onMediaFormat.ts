/**
 * Lambda: on-media-format
 *
 * Triggered by S3 ObjectCreated:* on the scrubbed-uploads bucket.
 *
 * Routes based on content type:
 *   Image path: resizes with sharp, outputs WebP + JPEG, strips metadata.
 *   Video path: kicks off AWS MediaConvert job (H.264/AAC MP4, max 1080p).
 *
 * Then calls pizzabase callback: POST /api/uploads/media-format-callback
 */

import { S3, MediaConvert } from "aws-sdk";
import { Pool } from "pg";
import * as path from "path";

const s3 = new S3({ region: process.env.AWS_REGION || "us-west-2" });

const SCRUBBED_BUCKET =
  process.env.SCRUBBED_UPLOADS_BUCKET || "scrubbed-uploads";
const PROCESSED_BUCKET =
  process.env.PROCESSED_UPLOADS_BUCKET || "processed-uploads";

const IMAGE_MAX_DIMENSION = parseInt(
  process.env.IMAGE_MAX_DIMENSION || "1920",
  10
);
const IMAGE_QUALITY = parseInt(process.env.IMAGE_QUALITY || "85", 10);

const PIZZABASE_API_URL =
  process.env.PIZZABASE_API_URL || "https://base.polls.pizza";

const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo",
]);

interface S3EventRecord {
  s3: {
    bucket: { name: string };
    object: { key: string; size: number };
  };
}

interface S3Event {
  Records: S3EventRecord[];
}

function getDbPool(): Pool {
  return new Pool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "pizzabase",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  });
}

function isVideoContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return VIDEO_MIME_TYPES.has(contentType);
}

async function processImage(
  key: string,
  body: Buffer,
  contentType: string
): Promise<Record<string, string>> {
  // Dynamic import of sharp (available in Lambda layer)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sharp = require("sharp");

  const ext = path.extname(key).toLowerCase();
  const baseName = path.basename(key, ext);
  const dirName = path.dirname(key);

  const image = sharp(body, {
    failOnError: false,
    animated: ext === ".gif",
  });

  const metadata = await image.metadata();
  const processedPath: Record<string, string> = {};

  // Determine if resize is needed
  const longestEdge = Math.max(
    metadata.width || 0,
    metadata.height || 0,
    metadata.pages
      ? Math.max(
          metadata.pageHeight || 0,
          metadata.width || 0
        )
      : 0
  );

  const needsResize = longestEdge > IMAGE_MAX_DIMENSION;

  // WebP output
  const webpKey = `${dirName}/${baseName}.webp`;
  let webpPipeline = image.clone();
  if (needsResize) {
    webpPipeline = webpPipeline.resize({
      width: IMAGE_MAX_DIMENSION,
      height: IMAGE_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  const webpBuffer = await webpPipeline
    .webp({ quality: IMAGE_QUALITY })
    .toBuffer();

  await s3
    .putObject({
      Bucket: PROCESSED_BUCKET,
      Key: webpKey,
      Body: webpBuffer,
      ContentType: "image/webp",
      ACL: "public-read",
    })
    .promise();

  processedPath.webp = `${PROCESSED_BUCKET}/${webpKey}`;

  // JPEG fallback
  const jpegKey = `${dirName}/${baseName}.jpg`;
  let jpegPipeline = image.clone();
  if (needsResize) {
    jpegPipeline = jpegPipeline.resize({
      width: IMAGE_MAX_DIMENSION,
      height: IMAGE_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  const jpegBuffer = await jpegPipeline
    .jpeg({ quality: IMAGE_QUALITY })
    .toBuffer();

  await s3
    .putObject({
      Bucket: PROCESSED_BUCKET,
      Key: jpegKey,
      Body: jpegBuffer,
      ContentType: "image/jpeg",
      ACL: "public-read",
    })
    .promise();

  processedPath.jpeg = `${PROCESSED_BUCKET}/${jpegKey}`;

  return processedPath;
}

async function kickOffMediaConvert(
  key: string,
  contentType: string
): Promise<Record<string, string>> {
  const mediaconvert = new MediaConvert({
    region: process.env.AWS_REGION || "us-west-2",
    endpoint: process.env.MEDIACONVERT_ENDPOINT,
  });

  const ext = path.extname(key).toLowerCase();
  const baseName = path.basename(key, ext);
  const dirName = path.dirname(key);

  const outputKey = `${dirName}/${baseName}.mp4`;

  const jobParams: MediaConvert.CreateJobRequest = {
    Role: process.env.MEDIACONVERT_ROLE_ARN!,
    Settings: {
      Inputs: [
        {
          FileInput: `s3://${SCRUBBED_BUCKET}/${key}`,
          AudioSelectors: {
            "Audio Selector 1": {
              DefaultSelection: "DEFAULT",
            },
          },
        },
      ],
      OutputGroups: [
        {
          Name: "MP4",
          OutputGroupSettings: {
            Type: "FILE_GROUP_SETTINGS",
            FileGroupSettings: {
              Destination: `s3://${PROCESSED_BUCKET}/${dirName}/`,
            },
          },
          Outputs: [
            {
              NameModifier: `/${baseName}`,
              ContainerSettings: {
                Container: "MP4",
              },
              VideoDescription: {
                CodecSettings: {
                  Codec: "H_264",
                  H264Settings: {
                    MaxBitrate: 5000000,
                    RateControlMode: "QVBR",
                    QvbrSettings: {
                      QvbrQualityLevel: 7,
                    },
                    SceneChangeDetect: "TRANSITION_DETECTION",
                    QualityTuningLevel: "SINGLE_PASS_HQ",
                    CodecProfile: "BASELINE",
                    CodecLevel: "AUTO",
                  },
                },
                Width: 1920,
                Height: 1080,
                ScalingBehavior: "DEFAULT",
              },
              AudioDescriptions: [
                {
                  CodecSettings: {
                    Codec: "AAC",
                    AacSettings: {
                      Bitrate: 128000,
                      CodingMode: "CODING_MODE_2_0",
                      SampleRate: 48000,
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };

  console.log(
    `Creating MediaConvert job for ${key}:`,
    JSON.stringify(jobParams, null, 2)
  );

  const job = await mediaconvert.createJob(jobParams).promise();

  console.log(`MediaConvert job created: ${job.Job?.Id}`);

  return {
    mp4: `${PROCESSED_BUCKET}/${outputKey}`,
    jobId: job.Job?.Id || "",
    status: "processing",
  } as Record<string, string>;
}

async function callPizzabaseCallback(
  uploadId: number,
  processedPath: Record<string, string> | null,
  status: "ready" | "failed"
): Promise<void> {
  const body = JSON.stringify({
    id: uploadId,
    processed_file_path: processedPath,
    status,
  });

  const callbackUrl = `${PIZZABASE_API_URL}/uploads/media-format-callback`;

  try {
    const response = await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!response.ok) {
      console.error(
        `Callback failed for upload ${uploadId}: HTTP ${response.status}`
      );
    } else {
      console.log(`Callback succeeded for upload ${uploadId}`);
    }
  } catch (err) {
    console.error(`Callback error for upload ${uploadId}:`, err);
  }
}

export async function handler(event: S3Event): Promise<void> {
  const pool = getDbPool();

  try {
    for (const record of event.Records) {
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
      const bucket = record.s3.bucket.name;

      console.log(
        `Processing media format for s3://${bucket}/${key}`
      );

      // Determine content type from S3 metadata or extension
      let contentType: string | undefined;
      try {
        const headResp = await s3
          .headObject({ Bucket: bucket, Key: key })
          .promise();
        contentType = headResp.ContentType;
      } catch {
        // Use extension-based detection
        const ext = path.extname(key).toLowerCase();
        const extToMime: Record<string, string> = {
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".gif": "image/gif",
          ".webp": "image/webp",
          ".heic": "image/heic",
          ".heif": "image/heif",
          ".mp4": "video/mp4",
          ".mov": "video/quicktime",
          ".webm": "video/webm",
        };
        contentType = extToMime[ext] || "application/octet-stream";
      }

      // Look up the upload by raw_file_path or file_path
      let uploadId: number | null = null;
      try {
        const result = await pool.query(
          `SELECT "id" FROM "uploads"
           WHERE "raw_file_path" = $1 OR "file_path" = $1
           LIMIT 1`,
          [key]
        );
        if (result.rowCount > 0) {
          uploadId = result.rows[0].id;
        }
      } catch (err) {
        console.error(`DB lookup error for ${key}:`, err);
      }

      if (!uploadId) {
        console.log(`No upload found for ${key}, skipping callback`);
        // Still process the media — the file may be from a different source.
      }

      const isVideo = isVideoContentType(contentType);

      if (isVideo) {
        // Video: kick off MediaConvert job
        try {
          const processedPath = await kickOffMediaConvert(key, contentType);
          console.log(
            `MediaConvert started for ${key}, jobId=${processedPath.jobId}`
          );

          if (uploadId) {
            // Update DB with processing status
            try {
              await pool.query(
                `UPDATE "uploads"
                 SET "media_status" = 'processing',
                     "processed_file_path" = $1,
                     "updated_at" = NOW()
                 WHERE "id" = $2`,
                [JSON.stringify(processedPath), uploadId]
              );
            } catch (dbErr) {
              console.error(`DB update error:`, dbErr);
            }
          }
        } catch (err) {
          console.error(`MediaConvert error for ${key}:`, err);
          if (uploadId) {
            await callPizzabaseCallback(uploadId, null, "failed");
          }
        }
      } else {
        // Image: process synchronously
        try {
          const resp = await s3
            .getObject({ Bucket: bucket, Key: key })
            .promise();
          const body = resp.Body as Buffer;

          if (!body || body.length === 0) {
            console.log(`Empty body for ${key}`);
            continue;
          }

          const processedPath = await processImage(key, body, contentType);

          console.log(
            `Image processed for ${key}:`,
            JSON.stringify(processedPath)
          );

          if (uploadId) {
            await callPizzabaseCallback(uploadId, processedPath, "ready");
          }
        } catch (err) {
          console.error(`Image processing error for ${key}:`, err);
          if (uploadId) {
            await callPizzabaseCallback(uploadId, null, "failed");
          }
        }
      }
    }
  } finally {
    await pool.end();
  }
}