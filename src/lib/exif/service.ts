/**
 * S3-aware EXIF extraction service with dependency injection.
 *
 * Extracts EXIF from S3 objects by reading the first 64KB, parsing with
 * exif-reader, serializing to JSON-safe format, and optionally running
 * the review heuristic.
 */

import * as aws from "aws-sdk";
import { extractExif, MAX_EXIF_SCAN } from "./extract";
import { serializeExif } from "./serialize";
import { reviewExif, ExifReview } from "./review";
import { getDigitalSourceType } from "./digitalSourceType";

export interface ExtractionResult {
  /** Serialized EXIF data (JSON-safe) */
  exif: Record<string, any> | null;
  /** Structured review / assessment */
  review: ExifReview | null;
  /** Digital Source Type from IPTC XMP (if available) */
  digitalSourceType: string | null;
}

export interface S3Context {
  s3Client: aws.S3;
  bucket: string;
}

export interface ExtractionOptions {
  filePath: string;
  /** Whether to run the review heuristic */
  includeReview?: boolean;
}

/**
 * Extract EXIF data from an S3 object.
 *
 * Reads the first 64KB (MAX_EXIF_SCAN) for fast extraction
 * without downloading the entire file.
 */
export async function extractExifAndReview(
  s3Ctx: S3Context,
  options: ExtractionOptions
): Promise<ExtractionResult> {
  try {
    // Pull the first 64KB from S3 — EXIF data lives at the start of
    // every supported file format
    const s3Object = await s3Ctx.s3Client
      .getObject({
        Bucket: s3Ctx.bucket,
        Key: options.filePath,
        Range: `bytes=0-${MAX_EXIF_SCAN - 1}`,
      })
      .promise();

    if (!s3Object.Body) {
      return { exif: null, review: null, digitalSourceType: null };
    }

    const buffer = Buffer.isBuffer(s3Object.Body)
      ? s3Object.Body
      : Buffer.from(s3Object.Body as ArrayBuffer);

    const exifSegment = extractExif(buffer);

    if (!exifSegment) {
      return { exif: null, review: null, digitalSourceType: null };
    }

    // Parse with exif-reader (dynamic require for testability)
    const exifReader = require("exif-reader");
    let rawExif: Record<string, any>;
    try {
      rawExif = exifReader(exifSegment);
    } catch {
      return { exif: null, review: null, digitalSourceType: null };
    }

    const serialized = serializeExif(rawExif);
    const review = options.includeReview ? reviewExif(rawExif) : null;
    const digitalSourceType = getDigitalSourceType(buffer);

    return {
      exif: serialized,
      review,
      digitalSourceType,
    };
  } catch (error) {
    // Log but don't propagate — EXIF extraction is best-effort
    console.error(`EXIF extraction failed for ${options.filePath}:`, error);
    return { exif: null, review: null, digitalSourceType: null };
  }
}
