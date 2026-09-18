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

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  MediaConvertClient,
  DescribeEndpointsCommand,
  CreateJobCommand,
  CreateJobCommandInput,
} from "@aws-sdk/client-mediaconvert";
import { initializeDataSource } from "../data-source";
import { Upload } from "../entity/Upload";
import {
  detectInputRotation,
  detectVideoDimensions,
  detectVideoDuration,
} from "../lib/mp4-rotation";
import { cdnUrlForKey } from "../lib/media-cdn";
import * as path from "path";

const s3 = new S3Client({ region: process.env.AWS_REGION || "us-west-2" });

const PROCESSED_BUCKET = process.env.UPLOAD_S3_BUCKET || "reports.polls.pizza";
const RAW_BUCKET = process.env.RAW_UPLOADS_BUCKET || "raw.polls.pizza";

const IMAGE_MAX_DIMENSION = parseInt(
  process.env.IMAGE_MAX_DIMENSION || "1920",
  10,
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

const POSTER_MAX_DIMENSION = 1080;
const POSTER_JPEG_QUALITY = 80;

/**
 * Scale {width, height} so the longest edge is at most `max`, preserving
 * aspect ratio, and round to the even dimensions MediaConvert requires.
 * Never upscales.
 */
function scaleToMaxDimension(
  dims: { width: number; height: number },
  max: number,
): { width: number; height: number } {
  const longest = Math.max(dims.width, dims.height);
  const scale = longest > max ? max / longest : 1;
  const even = (px: number) => Math.max(2, Math.round((px * scale) / 2) * 2);
  return { width: even(dims.width), height: even(dims.height) };
}

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
        `[on-media-format] No upload record for ${key} — may not be submitted yet`,
      );
      continue;
    }

    // Idempotency guard: duplicate S3 events must not re-encode.
    const priorOutput = upload.processedFilePath as Record<
      string,
      string
    > | null;
    if (upload.mediaStatus === "ready" && priorOutput?.webp) {
      console.log(
        `[on-media-format] Already processed upload ${upload.id}, skipping`,
      );
      continue;
    }

    try {
      upload.mediaStatus = "processing";
      await upload.save();

      if (IMAGE_EXTENSIONS.has(fileExt)) {
        const result = await processImage(key, upload.id);
        upload.processedFilePath = result;
        // sharp re-encode strips all metadata — this is the scrub event.
        upload.exifScrubbed = true;
        upload.mediaStatus = "ready";
        await upload.save();
        console.log(
          `[on-media-format] Image ${key} processed:`,
          JSON.stringify(result),
        );
      } else if (VIDEO_EXTENSIONS.has(fileExt)) {
        await transcodeVideo(key, upload.id);
        // Transcoded MP4 carries no source metadata.
        // NOTE: transcodeVideo re-fetches and saves processedFilePath
        // ({jobId}) — this stale instance must not clobber it, so update
        // only the column we own here.
        await Upload.update(upload.id, { exifScrubbed: true });
        // media_status flips to ready in on-mediaconvert-complete
        console.log(`[on-media-format] MediaConvert job started for ${key}`);
      } else {
        console.warn(
          `[on-media-format] Unknown extension: ${fileExt} for ${key}`,
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
  uploadId: number,
): Promise<Record<string, string>> {
  // sharp is provided via Lambda layer

  const sharp = require("sharp");

  const s3Object = await s3.send(
    new GetObjectCommand({ Bucket: RAW_BUCKET, Key: key }),
  );

  if (!s3Object.Body) {
    throw new Error(`Empty body for ${key}`);
  }

  const buffer = Buffer.from(await s3Object.Body.transformToByteArray());

  const ext = path.extname(key).toLowerCase();
  const image = sharp(buffer, {
    failOnError: false,
    animated: ext === ".gif",
  }).rotate(); // auto-orient from EXIF — phone portrait photos come in with
  // landscape pixels + Orientation≠1, and the re-encode strips the EXIF that
  // would otherwise fix display, so bake the rotation into the pixels now.

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
    await s3.send(
      new PutObjectCommand({
        Bucket: PROCESSED_BUCKET,
        Key: gifKey,
        Body: resized,
        ContentType: "image/gif",
        ACL: "public-read",
      }),
    );

    processedPath.gif =
      cdnUrlForKey(gifKey) ??
      `https://s3.us-west-2.amazonaws.com/${PROCESSED_BUCKET}/${gifKey}`;
    // Poster: the resized image is its own thumbnail, so consumers never
    // branch on media type. (Key, not URL — see processed_file_path docs.)
    processedPath.poster = gifKey;
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
  await s3.send(
    new PutObjectCommand({
      Bucket: PROCESSED_BUCKET,
      Key: webpKey,
      Body: webpBuffer,
      ContentType: "image/webp",
      ACL: "public-read",
    }),
  );

  processedPath.webp =
    cdnUrlForKey(webpKey) ??
    `https://s3.us-west-2.amazonaws.com/${PROCESSED_BUCKET}/${webpKey}`;

  // JPEG (fallback)
  const jpegBuffer = await resizePipeline
    .clone()
    .jpeg({ quality: IMAGE_QUALITY })
    .toBuffer();

  const jpegKey = `${prefix}.jpeg`;
  await s3.send(
    new PutObjectCommand({
      Bucket: PROCESSED_BUCKET,
      Key: jpegKey,
      Body: jpegBuffer,
      ContentType: "image/jpeg",
      ACL: "public-read",
    }),
  );

  processedPath.jpeg =
    cdnUrlForKey(jpegKey) ??
    `https://s3.us-west-2.amazonaws.com/${PROCESSED_BUCKET}/${jpegKey}`;

  // Poster: the resized JPEG (universally compatible as a thumbnail, already
  // capped at IMAGE_MAX_DIMENSION) doubles as the image poster. Consumers
  // read processed_file_path.poster without branching on media type.
  processedPath.poster = jpegKey;

  return processedPath;
}

// ── Video transcoding (AWS MediaConvert) ──────────────────

async function transcodeVideo(key: string, uploadId: number): Promise<void> {
  if (!mediaConvertEndpoint) {
    const mc = new MediaConvertClient({
      region: process.env.AWS_REGION || "us-west-2",
    });
    const data = await mc.send(new DescribeEndpointsCommand({}));
    mediaConvertEndpoint = data.Endpoints?.[0]?.Url || "";
    if (!mediaConvertEndpoint) {
      throw new Error("MediaConvert: no endpoints available");
    }
  }

  const mediaConvert = new MediaConvertClient({
    region: process.env.AWS_REGION || "us-west-2",
    endpoint: mediaConvertEndpoint,
  });

  const outputPrefix = `uploads/${uploadId}`;

  // Store job ID on the upload so on-mediaconvert-complete can find it
  const upload = await Upload.findOne({ where: { id: uploadId } as any });
  if (!upload) return;

  // MediaConvert ignores the input's display-matrix rotation: a phone video
  // recorded portrait (landscape pixels + 90° matrix) comes out sideways.
  // Detect the rotation from the raw tkhd and pass it to the job. The same
  // buffer also yields duration + dimensions for the poster frame capture.
  let rotate: "DEGREES_90" | "DEGREES_180" | "DEGREES_270" | undefined;
  let durationSeconds: number | null = null;
  let videoDims: { width: number; height: number } | null = null;
  try {
    const rawObject = await s3.send(
      new GetObjectCommand({ Bucket: RAW_BUCKET, Key: key }),
    );
    if (rawObject.Body) {
      const rawBuffer = Buffer.from(
        await rawObject.Body.transformToByteArray(),
      );
      rotate = detectInputRotation(rawBuffer) ?? undefined;
      durationSeconds = detectVideoDuration(rawBuffer);
      videoDims = detectVideoDimensions(rawBuffer);
      console.log(
        `[on-media-format] input rotation for ${key}: ${rotate ?? "none"}; ` +
          `duration: ${durationSeconds ?? "unknown"}s; dims: ` +
          (videoDims ? `${videoDims.width}x${videoDims.height}` : "unknown"),
      );
    }
  } catch (err) {
    console.warn(
      `[on-media-format] rotation detection failed for ${key} — transcoding without rotation correction:`,
      err,
    );
  }

  // Poster frame: capture the frame closest to 10% into the video, JPEG,
  // 1080px max dimension. Frame capture always encodes the first frame, then
  // one frame every captureInterval seconds — so we set the interval to ~10%
  // of the duration and mark which capture to use as the poster
  // (posterTargetIndex, resolved in on-mediaconvert-complete). When duration
  // is unknown we fall back to a 1s interval and take the second capture.
  const captureInterval = durationSeconds
    ? Math.min(10, Math.max(1, Math.round(durationSeconds / 10)))
    : 1;
  const posterTargetIndex = durationSeconds
    ? Math.max(
        1,
        Math.min(11, Math.round(durationSeconds / 10 / captureInterval)),
      )
    : 1;
  const posterDims = videoDims
    ? scaleToMaxDimension(videoDims, POSTER_MAX_DIMENSION)
    : null;

  const jobParams: CreateJobCommandInput = {
    Role: process.env.MEDIACONVERT_ROLE_ARN || "",
    Settings: {
      Inputs: [
        {
          FileInput: `s3://${RAW_BUCKET}/${key}`,
          ...(rotate ? { VideoSelector: { Rotate: rotate } } : {}),
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
                // Height only — Width omitted so MediaConvert preserves
                // aspect ratio (portrait phone videos stay portrait).
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
                      SampleRate: 48000,
                      CodingMode: "CODING_MODE_2_0",
                    },
                  },
                },
              ],
              NameModifier: "_transcoded",
            },
          ],
        },
        {
          // Poster frame capture — same processed destination as the main
          // transcode output; files are named {input}_poster.00000NN.jpg.
          OutputGroupSettings: {
            Type: "FILE_GROUP_SETTINGS",
            FileGroupSettings: {
              Destination: `s3://${PROCESSED_BUCKET}/${outputPrefix}/`,
            },
          },
          Outputs: [
            {
              ContainerSettings: { Container: "RAW" },
              VideoDescription: {
                CodecSettings: {
                  Codec: "FRAME_CAPTURE",
                  FrameCaptureSettings: {
                    FramerateNumerator: 1,
                    FramerateDenominator: captureInterval,
                    MaxCaptures: posterTargetIndex + 1,
                    Quality: POSTER_JPEG_QUALITY,
                  },
                },
                // Dimensions: scale the source to a 1080px max edge (both
                // edges specified so portrait and landscape both fit). When
                // the source dims are unknown, cap height at 1080 and let
                // MediaConvert preserve aspect ratio (phone videos are
                // typically portrait, matching the transcode output).
                ...(posterDims
                  ? { Width: posterDims.width, Height: posterDims.height }
                  : { Height: 1080 }),
                ScalingBehavior: "DEFAULT",
              },
              Extension: "jpg",
              NameModifier: "_poster",
            },
          ],
        },
      ],
    },
    UserMetadata: {
      uploadId: String(uploadId),
      sourceKey: key,
      posterTargetIndex: String(posterTargetIndex),
    },
  };

  const job = await mediaConvert.send(new CreateJobCommand(jobParams));

  // Store the job ID so on-mediaconvert-complete can match it
  upload.processedFilePath = { jobId: job.Job?.Id || "" };
  await upload.save();

  console.log(
    `[on-media-format] MediaConvert job ${job.Job?.Id} started for upload ${uploadId}`,
  );
}
