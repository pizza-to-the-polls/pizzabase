/**
 * EXIF extraction service — encapsulates the full pipeline of S3 reads,
 * binary extraction, metadata parsing, XMP/DST extraction, and review
 * assessment. The controller delegates to this module so it stays thin.
 */

import {
  extractExifWithRetry,
  extractXmpWithRetry,
  serializeExif,
  reviewExif,
  parseDigitalSourceType,
  MAX_EXIF_BYTES,
  ExifData,
} from "../exif";

/** Initial byte range for EXIF scanning – first 64 KiB. */
const INITIAL_RANGE_BYTES = 65535;

// ---------------------------------------------------------------------------
// Dependency interfaces – keep the service testable without real S3
// ---------------------------------------------------------------------------

export interface ExifServiceDeps {
  s3Client: {
    getObject(params: {
      Bucket: string;
      Key: string;
      Range?: string;
    }): { promise(): Promise<{ Body?: Buffer | null }> };
  };
  bucket: string;
}

export interface ExifServiceOptions {
  filePath: string;
  includeReview: boolean;
}

export interface ExifServiceResult {
  exif: any | null;
  review?: any;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract EXIF metadata and (optionally) produce a review assessment for the
 * given S3 object.  All S3 I/O goes through the injected `s3Client`.
 */
export async function extractExifAndReview(
  deps: ExifServiceDeps,
  options: ExifServiceOptions
): Promise<ExifServiceResult> {
  const { s3Client, bucket } = deps;
  const { filePath, includeReview } = options;

  // IPTC Digital Source Type – populated from embedded XMP or sidecar.
  let dst: { uri: string; label: string } | null = null;

  // ---- 1. Fetch initial byte range ----------------------------------------
  const s3Object = await s3Client
    .getObject({
      Bucket: bucket,
      Key: filePath,
      Range: `bytes=0-${INITIAL_RANGE_BYTES}`,
    })
    .promise();

  let tiffPayload: Buffer | null = null;
  let combinedBuffer: Buffer | null = null;

  if (s3Object.Body) {
    const initialBuffer = s3Object.Body as Buffer;

    // ---- 2. Bounded EXIF extraction with one follow-up --------------------
    tiffPayload = await extractExifWithRetry(
      initialBuffer,
      0,
      async (start: number, end: number) => {
        if (end - start + 1 > MAX_EXIF_BYTES) return null;
        try {
          const followUp = await s3Client
            .getObject({
              Bucket: bucket,
              Key: filePath,
              Range: `bytes=${start}-${end}`,
            })
            .promise();
          return (followUp.Body as Buffer) ?? null;
        } catch {
          return null;
        }
      }
    );

    // XMP is almost certainly in the initial range when EXIF was.
    combinedBuffer = initialBuffer;
  }

  // ---- 3. XMP extraction (embedded + sidecar) -----------------------------
  let xmpXml: string | null = null;
  if (combinedBuffer) {
    xmpXml = await extractXmpWithRetry(
      combinedBuffer,
      0,
      async (start: number, end: number) => {
        if (end - start + 1 > MAX_EXIF_BYTES) return null;
        try {
          const followUp = await s3Client
            .getObject({
              Bucket: bucket,
              Key: filePath,
              Range: `bytes=${start}-${end}`,
            })
            .promise();
          return (followUp.Body as Buffer) ?? null;
        } catch {
          return null;
        }
      }
    );
  }

  if (!xmpXml) {
    try {
      const sidecar = await s3Client
        .getObject({ Bucket: bucket, Key: `${filePath}.xmp` })
        .promise();
      if (sidecar.Body) {
        xmpXml = (sidecar.Body as Buffer).toString("utf-8") || null;
      }
    } catch {
      // No sidecar – proceed.
    }
  }

  dst = xmpXml ? parseDigitalSourceType(xmpXml) : null;
  if (dst && !dst.uri) dst = null;

  // ---- 4. Parse EXIF and produce response ---------------------------------
  if (tiffPayload) {
    const exifReader = require("exif-reader");
    const parsed: ExifData = exifReader(tiffPayload);
    const serialized = serializeExif(parsed);
    const review = reviewExif(parsed, dst);

    return includeReview
      ? { exif: serialized, review }
      : { exif: serialized };
  }

  return includeReview
    ? { exif: null, review: reviewExif(null, dst) }
    : { exif: null };
}