/**
 * Lambda: on-media-format
 *
 * Triggered by S3 ObjectCreated:* events on the scrubbed-uploads bucket.
 *
 * Routes to:
 *   - Image resizing (sharp): resize to max 1920px, WebP + JPEG output
 *   - Video transcoding (AWS MediaConvert): H.264/AAC MP4, max 1080p
 *
 * Writes formatted outputs to the processed-uploads bucket (public-read)
 * and calls the pizzabase callback to update the Upload record.
 */

import { S3, MediaConvert } from "aws-sdk";

const s3 = new S3();
const PROCESSED_BUCKET =
  process.env.PROCESSED_UPLOADS_BUCKET ||
  process.env.UPLOAD_S3_BUCKET ||
  "pizzabase-processed-uploads";
const SCRUBBED_BUCKET =
  process.env.SCRUBBED_UPLOADS_BUCKET ||
  process.env.UPLOAD_S3_BUCKET ||
  "pizzabase-scrubbed-uploads";

const IMAGE_MAX_DIMENSION = parseInt(
  process.env.IMAGE_MAX_DIMENSION || "1920",
  10
);
const IMAGE_QUALITY = parseInt(process.env.IMAGE_QUALITY || "85", 10);
const VIDEO_MAX_DIMENSION = parseInt(
  process.env.VIDEO_MAX_DIMENSION || "1080",
  10
);

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

interface S3EventRecord {
  s3: {
    bucket: { name: string };
    object: { key: string; size: number };
  };
}

/** Cached MediaConvert endpoint (changes on first call to describeEndpoints) */
let mediaConvertEndpoint: string | null = null;

export const handler = async (event: { Records: S3EventRecord[] }) => {
  for (const record of event.Records) {
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

    console.log(
      `[on-media-format] Processing: s3://${record.s3.bucket.name}/${key}`
    );

    const fileExt = key.split(".").pop()?.toLowerCase() || "";

    try {
      if (IMAGE_EXTENSIONS.has(fileExt)) {
        await processImage(key);
      } else if (VIDEO_EXTENSIONS.has(fileExt)) {
        await transcodeVideo(key);
      } else {
        console.warn(
          `[on-media-format] Unknown file extension: ${fileExt} for key: ${key}`
        );
      }
    } catch (error) {
      console.error(`[on-media-format] Failed for ${key}:`, error);
    }
  }
};

// ── Image processing (sharp) ────────────────────────────

async function processImage(key: string): Promise<void> {
  const s3Object = await s3
    .getObject({ Bucket: SCRUBBED_BUCKET, Key: key })
    .promise();

  if (!s3Object.Body) {
    throw new Error(`Empty body for ${key}`);
  }

  const buffer = Buffer.isBuffer(s3Object.Body)
    ? s3Object.Body
    : Buffer.from(s3Object.Body as ArrayBuffer);

  const uploadId = s3Object.Metadata?.["x-amz-meta-upload-id"] || "";
  const baseKey = uploadId
    ? `uploads/${uploadId}`
    : key.replace(/\.[^.]+$/, "");

  // Use sharp for image processing
  const sharp = require("sharp");
  const image = sharp(buffer);
  const metadata = await image.metadata();

  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const needsResize =
    width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION;

  const processedFilePath: Record<string, string | null> = {};

  if (metadata.format === "gif") {
    // Animated GIFs: preserve animation, resize if needed
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

    const gifKey = `${baseKey}.gif`;
    await s3
      .putObject({
        Bucket: PROCESSED_BUCKET,
        Key: gifKey,
        Body: resized,
        ContentType: "image/gif",
        ACL: "public-read",
        Metadata: { "x-amz-meta-upload-id": uploadId },
      })
      .promise();

    processedFilePath.gif = `https://${PROCESSED_BUCKET}.s3.amazonaws.com/${gifKey}`;

    console.log(`[on-media-format] Processed GIF: ${processedFilePath.gif}`);
  } else {
    // WebP (primary format)
    const webpBuffer = needsResize
      ? await image
          .resize({
            width: IMAGE_MAX_DIMENSION,
            height: IMAGE_MAX_DIMENSION,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: IMAGE_QUALITY })
          .toBuffer()
      : await image.webp({ quality: IMAGE_QUALITY }).toBuffer();

    const webpKey = `${baseKey}.webp`;
    await s3
      .putObject({
        Bucket: PROCESSED_BUCKET,
        Key: webpKey,
        Body: webpBuffer,
        ContentType: "image/webp",
        ACL: "public-read",
        Metadata: { "x-amz-meta-upload-id": uploadId },
      })
      .promise();

    processedFilePath.webp = `https://${PROCESSED_BUCKET}.s3.amazonaws.com/${webpKey}`;

    // JPEG (fallback format)
    const jpegBuffer = needsResize
      ? await image
          .resize({
            width: IMAGE_MAX_DIMENSION,
            height: IMAGE_MAX_DIMENSION,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: IMAGE_QUALITY })
          .toBuffer()
      : await image.jpeg({ quality: IMAGE_QUALITY }).toBuffer();

    const jpegKey = `${baseKey}.jpeg`;
    await s3
      .putObject({
        Bucket: PROCESSED_BUCKET,
        Key: jpegKey,
        Body: jpegBuffer,
        ContentType: "image/jpeg",
        ACL: "public-read",
        Metadata: { "x-amz-meta-upload-id": uploadId },
      })
      .promise();

    processedFilePath.jpeg = `https://${PROCESSED_BUCKET}.s3.amazonaws.com/${jpegKey}`;

    console.log(`[on-media-format] Processed image: ${processedFilePath.webp}`);
  }

  // Notify pizzabase
  if (uploadId) {
    await notifyCallback({
      id: parseInt(uploadId, 10),
      processed_file_path: processedFilePath,
      status: "ready",
    });
  }
}

// ── Video transcoding (AWS MediaConvert) ─────────────────

async function transcodeVideo(key: string): Promise<void> {
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

  // Extract upload ID from the S3 object metadata
  let uploadId = "";
  try {
    const headObj = await s3
      .headObject({ Bucket: SCRUBBED_BUCKET, Key: key })
      .promise();
    uploadId = headObj.Metadata?.["x-amz-meta-upload-id"] || "";
  } catch {
    // Proceed without uploadId
  }

  const baseKey = uploadId
    ? `uploads/${uploadId}`
    : key.replace(/\.[^.]+$/, "");

  const jobParams = {
    Role: process.env.MEDIACONVERT_ROLE_ARN || "",
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
          OutputGroupSettings: {
            Type: "FILE_GROUP_SETTINGS",
            FileGroupSettings: {
              Destination: `s3://${PROCESSED_BUCKET}/${baseKey}/`,
            },
          },
          Outputs: [
            {
              ContainerSettings: {
                Container: "MP4",
              },
              VideoDescription: {
                CodecSettings: {
                  Codec: "H_264",
                  H264Settings: {
                    MaxBitrate: 5000000,
                    RateControlMode: "QVBR",
                    QualityTuningLevel: "SINGLE_PASS",
                  },
                },
                Width: VIDEO_MAX_DIMENSION,
                Height: VIDEO_MAX_DIMENSION,
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
      uploadId: uploadId || "",
      sourceKey: key,
    },
  };

  const job = await mediaConvert.createJob(jobParams).promise();

  console.log(
    `[on-media-format] MediaConvert job created: ${job.Job?.Id} for key: ${key}`
  );
}

// ── PizzaBase callback ───────────────────────────────────

async function notifyCallback(body: {
  id: number;
  processed_file_path: Record<string, string | null>;
  status: string;
}): Promise<void> {
  // Notify the pizzabase backend that formatting is complete.
  // The callback URL should be configured as an environment variable.
  const callbackUrl = process.env.PIZZABASE_CALLBACK_URL;
  if (!callbackUrl) {
    console.warn(
      "[on-media-format] PIZZABASE_CALLBACK_URL not configured," +
        " skipping callback"
    );
    return;
  }

  try {
    await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error("[on-media-format] Callback to pizzabase failed:", error);
  }
}
