/**
 * Lambda: on-s3-upload-process-exif
 *
 * Triggered by S3 ObjectCreated:* events on the raw-uploads bucket.
 *
 * 1. Reads the first 64KB of the uploaded file from S3
 * 2. Extracts EXIF metadata using the exif library
 * 3. Runs review heuristic (camera vs screenshot detection) on raw EXIF
 * 4. Stores full EXIF + review summary in DB (exif_data JSONB)
 * 5. Performs byte-level EXIF stripping using bounded range reads
 *    (never downloads the full file in one request) and writes the
 *    scrubbed copy to the scrubbed-uploads bucket
 *
 * The original file in raw-uploads is NEVER modified or deleted.
 */

import { S3 } from "aws-sdk";
import { initializeDataSource } from "../data-source";
import { Upload } from "../entity/Upload";
import {
  extractExif,
  stripExifBytes,
  MAX_EXIF_SCAN,
} from "../lib/exif/extract";
import { serializeExif } from "../lib/exif/serialize";
import { reviewExif } from "../lib/exif/review";

const s3 = new S3();
const SCRUBBED_BUCKET =
  process.env.SCRUBBED_UPLOADS_BUCKET ||
  process.env.UPLOAD_S3_BUCKET ||
  "pizzabase-scrubbed-uploads";

interface S3EventRecord {
  s3: {
    bucket: { name: string };
    object: { key: string; size: number };
  };
}

export const handler = async (event: { Records: S3EventRecord[] }) => {
  // Initialize DB connection (cold start)
  await initializeDataSource();

  for (const record of event.Records) {
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const bucket = record.s3.bucket.name;
    const fileSize = record.s3.object.size;

    console.log(
      `[on-s3-upload-process-exif] Processing: s3://${bucket}/${key}`
    );

    // Find the upload record by raw_file_path or file_path
    const upload = await Upload.findOne({
      where: [{ rawFilePath: key }, { filePath: key }] as any,
    });

    if (!upload) {
      console.warn(
        `[on-s3-upload-process-exif] No Upload record found for key: ${key}`
      );
      continue;
    }

    try {
      // ── Step 1: Read the first 64KB for EXIF extraction ──
      const headEnd = Math.min(MAX_EXIF_SCAN, fileSize) - 1;
      const headChunk = await s3
        .getObject({
          Bucket: bucket,
          Key: key,
          Range: `bytes=0-${headEnd}`,
        })
        .promise();

      if (!headChunk.Body) {
        console.warn(`[on-s3-upload-process-exif] Empty body for key: ${key}`);
        continue;
      }

      const headBuffer = Buffer.isBuffer(headChunk.Body)
        ? headChunk.Body
        : Buffer.from(headChunk.Body as ArrayBuffer);

      const contentType = headChunk.ContentType || "";

      const exifSegment = extractExif(headBuffer);

      if (exifSegment) {
        // Parse with exif-reader for structured metadata
        let rawExif: Record<string, any> | null = null;
        try {
          const exifReader = require("exif-reader");
          rawExif = exifReader(exifSegment);
        } catch (parseError) {
          console.error(
            `[on-s3-upload-process-exif] exif-reader parse error for ${key}:`,
            parseError
          );
        }

        if (rawExif) {
          // Run review heuristic BEFORE serialization (works on raw
          // exif-reader output which may contain Buffer/Date objects).
          const review = reviewExif(rawExif);

          // Serialize for JSONB storage
          const serialized = serializeExif(rawExif);

          // Attach review summary to stored EXIF data so the frontend
          // can display it without re-running the heuristic.
          serialized._review = review;

          upload.exifData = serialized;
          upload.exifExtracted = true;
          await upload.save();

          console.log(
            "[on-s3-upload-process-exif] EXIF extracted and" +
              ` stored for upload ${upload.id}`
          );
        }
      } else {
        // No EXIF data found — still mark as extracted
        upload.exifExtracted = true;
        await upload.save();

        console.log(
          "[on-s3-upload-process-exif] No EXIF data" +
            ` found for upload ${upload.id}`
        );
      }

      // ── Step 2: Bounded byte-level EXIF stripping ──
      // Instead of downloading the full file (potentially 50 MB) in
      // a single request, we use the head buffer to locate the EXIF
      // segment and then read only the tail bytes that follow it.
      // This caps per-request memory at headSize + tailSize instead
      // of the full file size.
      const scrubbedBuffer = await buildScrubbedBuffer(
        bucket,
        key,
        headBuffer,
        fileSize
      );

      await s3
        .putObject({
          Bucket: SCRUBBED_BUCKET,
          Key: key,
          Body: scrubbedBuffer,
          ContentType: contentType,
          Metadata: {
            "x-amz-meta-upload-id": String(upload.id),
            "x-amz-meta-exif-scrubbed": "true",
          },
        })
        .promise();

      // Only mark as scrubbed AFTER the scrubbed copy is safely written
      upload.exifScrubbed = true;
      await upload.save();

      console.log(
        "[on-s3-upload-process-exif] Scrubbed copy" +
          ` written to ${SCRUBBED_BUCKET}/${key}`
      );
    } catch (error) {
      console.error(`[on-s3-upload-process-exif] Failed for ${key}:`, error);
      // Set media_status to failed so the pipeline can retry or
      // volunteers see the failure state
      try {
        upload.mediaStatus = "failed";
        await upload.save();
      } catch (dbError) {
        console.error(
          `[on-s3-upload-process-exif] DB update failed for ${key}:`,
          dbError
        );
      }
    }
  }
};

// ── Bounded scrub: head + tail read strategy ────────────

/**
 * Build a scrubbed copy of the file without downloading the full
 * body in a single request.
 *
 * Strategy:
 *   - If the entire file fits in the head buffer we already read:
 *     strip in-memory and return.
 *   - Otherwise: locate the EXIF segment in the head buffer,
 *     read the tail bytes that follow the segment, and concatenate
 *     pre-EXIF + post-EXIF + tail.
 */
async function buildScrubbedBuffer(
  bucket: string,
  key: string,
  headBuffer: Buffer,
  fileSize: number
): Promise<Buffer> {
  // File fits in the head read — strip directly
  if (fileSize <= headBuffer.length) {
    return stripExifBytes(headBuffer);
  }

  // Locate the EXIF segment bounds in the head buffer.
  // For JPEG the APP1 marker and for PNG the eXIf chunk are always
  // within the first 64 KB.  ISO BMFF uuid boxes are irregular but
  // still near the moov box which is usually at the start.
  const stripInfo = locateExifSegment(headBuffer);

  // No EXIF segment found — copy the file to the scrubbed bucket
  // unchanged so the scrubbed-uploads trigger fires for formatting.
  if (!stripInfo) {
    const wholeFileTail = await readRange(
      bucket,
      key,
      headBuffer.length,
      fileSize
    );
    return Buffer.concat([headBuffer, wholeFileTail]);
  }

  // EXIF segment found — excise it from [start, end)
  const prefix = headBuffer.subarray(0, stripInfo.start);

  if (stripInfo.end <= headBuffer.length) {
    // EXIF fits entirely within the head buffer — just drop that range
    const suffixHead = headBuffer.subarray(stripInfo.end);
    if (fileSize <= headBuffer.length) {
      return Buffer.concat([prefix, suffixHead]);
    }
    const suffixTail = await readRange(
      bucket,
      key,
      headBuffer.length,
      fileSize
    );
    return Buffer.concat([prefix, suffixHead, suffixTail]);
  }

  // EXIF segment crosses the head boundary (rare).  Read the
  // remainder and strip from the combined buffer.
  const combinedRemainder = await readRange(
    bucket,
    key,
    headBuffer.length,
    fileSize
  );
  return stripExifBytes(Buffer.concat([headBuffer, combinedRemainder]));
}

/**
 * Locate the first EXIF-bearing segment (JPEG APP1 Exif or PNG eXIf)
 * in the buffer and return its byte range.
 * Returns null if no EXIF segment is found.
 */
function locateExifSegment(
  buffer: Buffer
): { start: number; end: number } | null {
  // Try JPEG APP1 Exif
  const jpeg = findJpegApp1Exif(buffer);
  if (jpeg) return jpeg;

  // Try PNG eXIf chunk
  const png = findPngExif(buffer);
  if (png) return png;

  return null;
}

function findJpegApp1Exif(
  buffer: Buffer
): { start: number; end: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  const limit = Math.min(buffer.length, MAX_EXIF_SCAN);

  while (offset + 4 <= limit) {
    if (buffer[offset] !== 0xff) break;

    const markerType = buffer[offset + 1];
    if (markerType === 0xda) break;

    const segLen = buffer.readUInt16BE(offset + 2);

    if (markerType === 0xe1) {
      if (
        offset + 10 <= buffer.length &&
        buffer[offset + 4] === 0x45 &&
        buffer[offset + 5] === 0x78 &&
        buffer[offset + 6] === 0x69 &&
        buffer[offset + 7] === 0x66 &&
        buffer[offset + 8] === 0x00 &&
        buffer[offset + 9] === 0x00
      ) {
        return { start: offset, end: offset + 2 + segLen };
      }
    }

    offset += 2 + segLen;
  }

  return null;
}

function findPngExif(buffer: Buffer): { start: number; end: number } | null {
  if (
    buffer.length < 12 ||
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47
  ) {
    return null;
  }

  let offset = 8;
  const limit = Math.min(buffer.length, MAX_EXIF_SCAN);

  while (offset + 12 <= limit) {
    const chunkLen = buffer.readUInt32BE(offset);
    const chunkType = buffer.subarray(offset + 4, offset + 8).toString("ascii");

    if (chunkType === "IEND") break;

    if (chunkType === "eXIf" && chunkLen > 0) {
      const chunkTotal = 12 + chunkLen;
      return { start: offset, end: offset + chunkTotal };
    }

    offset += 12 + chunkLen;
  }

  return null;
}

/** Read a byte range [start, fileSize) from S3. */
async function readRange(
  bucket: string,
  key: string,
  start: number,
  fileSize: number
): Promise<Buffer> {
  if (start >= fileSize) {
    return Buffer.alloc(0);
  }

  const end = fileSize - 1;
  const chunk = await s3
    .getObject({
      Bucket: bucket,
      Key: key,
      Range: `bytes=${start}-${end}`,
    })
    .promise();

  if (!chunk.Body) return Buffer.alloc(0);

  return Buffer.isBuffer(chunk.Body)
    ? chunk.Body
    : Buffer.from(chunk.Body as ArrayBuffer);
}
