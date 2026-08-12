/**
 * Lambda: on-s3-upload-process-exif
 *
 * Triggered by S3 ObjectCreated:* on the raw.polls.pizza bucket.
 *
 * 1. Reads the first 64KB of the original from S3.
 * 2. Runs ExtractExif → parses with exif-reader → stores in exif_data JSONB.
 * 3. Updates DB: exif_extracted = true.
 * 4. Does NOT delete or modify the original.
 *
 * Metadata stripping happens later in on-media-format when sharp re-encodes.
 */

import { S3 } from "aws-sdk";
import { initializeDataSource } from "../data-source";
import { Upload } from "../entity/Upload";
import { extractExif } from "../lib/exif/extract";

const s3 = new S3({ region: process.env.AWS_REGION || "us-west-2" });

const INITIAL_RANGE_BYTES = 65535;

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
        `[on-s3-upload-process-exif] No upload record for ${key} — may not be submitted yet`
      );
      continue;
    }

    // Already processed? Idempotency guard.
    if (upload.exifExtracted) {
      console.log(
        `[on-s3-upload-process-exif] EXIF already extracted for upload ${upload.id}`
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
      const tiffPayload = extractExif(initialBuffer);

      if (tiffPayload) {
        try {
          const exifReader = require("exif-reader");
          const parsed = exifReader(tiffPayload);
          const { serializeExif } = require("../lib/exif/serialize");
          const exifData = serializeExif(parsed) as Record<string, unknown>;

          upload.exifData = exifData;
          console.log(
            `[on-s3-upload-process-exif] EXIF extracted for upload ${upload.id}:`,
            JSON.stringify(exifData).slice(0, 200)
          );
        } catch (parseErr) {
          console.error(
            `[on-s3-upload-process-exif] Failed to parse EXIF for ${key}:`,
            parseErr
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
}
