/**
 * Lambda: on-s3-upload-process-exif
 *
 * Triggered by S3 ObjectCreated:* on the raw.polls.pizza bucket.
 *
 * 1. Reads the first 64KB of the original from S3.
 * 2. For video files: probes duration from MP4/MOV mvhd box.
 *    - If over MEDIA_MAX_DURATION_SECONDS (default 90): marks failed,
 *      sets failure_reason, and does NOT chain to on-media-format.
 *    - If under limit: stores duration_seconds in exif_data and continues.
 * 3. Runs ExtractExif → parses with exif-reader → stores in exif_data JSONB.
 * 4. Updates DB: exif_extracted = true.
 * 5. Does NOT delete or modify the original.
 *
 * Metadata stripping happens later in on-media-format when sharp re-encodes.
 */

import { S3, Lambda } from "aws-sdk";
import { initializeDataSource } from "../data-source";
import { Upload } from "../entity/Upload";
import {
  extractExif,
  probeVideoDuration,
  isAnyIsoBmff,
} from "../lib/exif/extract";

const s3 = new S3({ region: process.env.AWS_REGION || "us-west-2" });

// S3 notification configs cannot share an event type on one bucket, so only
// this Lambda carries the ObjectCreated:* trigger. on-media-format is chained
// from here via an async invoke once the whole event is handled.
const MEDIA_FORMAT_FUNCTION =
  process.env.MEDIA_FORMAT_FUNCTION_NAME || "pizzabase-dev-on-media-format";

const INITIAL_RANGE_BYTES = 65535;

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm"]);

function getMaxDurationSeconds(): number {
  const raw = process.env.MEDIA_MAX_DURATION_SECONDS;
  if (raw !== undefined && raw !== "") {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 90;
}

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
    const bucket = record.s3.bucket.name;

    console.log(`[on-s3-upload-process-exif] s3://${bucket}/${key}`);

    // Find the upload by raw_file_path
    const upload = await Upload.findOne({ where: { rawFilePath: key } as any });
    if (!upload) {
      console.log(
        `[on-s3-upload-process-exif] No upload record for ${key} — may not be submitted yet`,
      );
      continue;
    }

    // Already processed? Idempotency guard.
    if (upload.exifExtracted || upload.mediaStatus === "failed") {
      console.log(
        `[on-s3-upload-process-exif] Already processed for upload ${upload.id} (exifExtracted=${upload.exifExtracted}, mediaStatus=${upload.mediaStatus})`,
      );
      continue;
    }

    try {
      // Read first 64KB
      const resp = await s3
        .getObject({
          Bucket: bucket,
          Key: key,
          Range: `bytes=0-${INITIAL_RANGE_BYTES}`,
        })
        .promise();

      if (!resp.Body) {
        console.log(`[on-s3-upload-process-exif] Empty body for ${key}`);
        upload.exifExtracted = true;
        await upload.save();
        continue;
      }

      const initialBuffer = resp.Body as Buffer;

      // Detect whether this is a video file.
      const fileExt = key.split(".").pop()?.toLowerCase() || "";
      const fileSize = record.s3.object.size;
      const isVideoExt = VIDEO_EXTENSIONS.has(fileExt);
      const isBmff = isAnyIsoBmff(initialBuffer);

      // Only check duration for video files (extension-based or BMFF with no
      // HEIF image brand). Images with BMFF container (HEIF/HEIC/AVIF) are
      // excluded by extension check first.
      const isVideo =
        isVideoExt ||
        (isBmff &&
          fileExt !== "heic" &&
          fileExt !== "heif" &&
          fileExt !== "avif");

      if (isVideo) {
        const maxDuration = getMaxDurationSeconds();

        // Try duration probe from initial buffer.
        let durationResult = probeVideoDuration(initialBuffer, fileSize);

        // If moov not in initial range, try reading from the end.
        if (!durationResult.found && fileSize > INITIAL_RANGE_BYTES) {
          const tailStart = Math.max(0, fileSize - INITIAL_RANGE_BYTES);
          try {
            const tailResp = await s3
              .getObject({
                Bucket: bucket,
                Key: key,
                Range: `bytes=${tailStart}-${fileSize - 1}`,
              })
              .promise();
            if (tailResp.Body) {
              const tailBuffer = tailResp.Body as Buffer;
              durationResult = probeVideoDuration(tailBuffer, fileSize);
            }
          } catch (tailErr) {
            console.log(
              `[on-s3-upload-process-exif] Tail read failed for ${key}, continuing without duration check:`,
              tailErr,
            );
          }
        }

        // If duration found and exceeds limit, fail fast.
        if (
          durationResult.found &&
          durationResult.durationSeconds > maxDuration
        ) {
          const durDisplay = Math.round(durationResult.durationSeconds);
          upload.mediaStatus = "failed";
          upload.exifExtracted = true;
          upload.failureReason = `video exceeds ${maxDuration}s duration limit (duration: ${durDisplay}s)`;
          await upload.save();
          console.log(
            `[on-s3-upload-process-exif] Video ${key} exceeds duration limit ` +
              `(${durDisplay}s > ${maxDuration}s) — marked failed`,
          );
          continue;
        }

        // If duration found and within limit, store it in exif_data.
        if (durationResult.found) {
          upload.exifData = {
            ...(upload.exifData || {}),
            duration_seconds: durationResult.durationSeconds,
          };
          console.log(
            `[on-s3-upload-process-exif] Video duration for ${key}: ${durationResult.durationSeconds}s`,
          );
        }
      }

      const tiffPayload = extractExif(initialBuffer);

      if (tiffPayload) {
        try {
          const exifReader = require("exif-reader");
          const parsed = exifReader(tiffPayload);
          const { serializeExif } = require("../lib/exif/serialize");
          const exifData = serializeExif(parsed) as Record<string, unknown>;

          upload.exifData = {
            ...(upload.exifData || {}),
            ...exifData,
          };
          console.log(
            `[on-s3-upload-process-exif] EXIF extracted for upload ${upload.id}:`,
            JSON.stringify(exifData).slice(0, 200),
          );
        } catch (parseErr) {
          console.error(
            `[on-s3-upload-process-exif] Failed to parse EXIF for ${key}:`,
            parseErr,
          );
        }
      } else {
        console.log(`[on-s3-upload-process-exif] No EXIF found in ${key}`);
      }

      upload.exifExtracted = true;
      await upload.save();
    } catch (err) {
      console.error(`[on-s3-upload-process-exif] Failed for ${key}:`, err);
    }
  }

  // Chain the media-format pass (image resize / video transcode) on the same
  // event. Fire-and-forget: media-format is idempotent and handles its own
  // errors; failures must not fail EXIF extraction.
  // Skip chaining if any upload in this event was already marked failed
  // (e.g., over-duration video) — we handle this per-record above, but
  // on-media-format itself is idempotent and will skip failed uploads.
  try {
    const lambda = new Lambda({
      region: process.env.AWS_REGION || "us-west-2",
    });
    await lambda
      .invoke({
        FunctionName: MEDIA_FORMAT_FUNCTION,
        InvocationType: "Event",
        Payload: JSON.stringify(event),
      })
      .promise();
  } catch (err) {
    console.error(
      "[on-s3-upload-process-exif] Failed to invoke on-media-format:",
      err,
    );
  }
}
