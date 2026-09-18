/**
 * EXIF extraction service — encapsulates the full pipeline of S3 reads,
 * binary extraction, metadata parsing, XMP/DST extraction, and review
 * assessment. The controller delegates to this module so it stays thin.
 */

import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

import {
  extractExifWithRetry,
  extractExifFromIsoBmffVideo,
  extractXmpWithRetry,
  serializeExif,
  reviewExif,
  parseDigitalSourceType,
  detectC2pa,
  MAX_EXIF_BYTES,
  isAnyIsoBmff,
  ExifData,
} from "../exif";

/** Initial byte range for EXIF scanning – first 64 KiB. */
const INITIAL_RANGE_BYTES = 65535;

// ---------------------------------------------------------------------------
// Dependency interfaces – keep the service testable without real S3
// ---------------------------------------------------------------------------

export interface ExifServiceDeps {
  s3Client: {
    send(command: {
      input: { Bucket: string; Key: string; Range?: string };
    }): Promise<{ Body?: Buffer | null; ContentLength?: number }>;
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
  c2pa?: { detected: boolean; label: string | null };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The SDK returns GetObject Body as a Readable stream in Node (string or
 * Buffer only in special cases). The EXIF parser needs a real Buffer, so
 * collect the stream. Calls must handle the collection exactly once —
 * a consumed stream cannot be re-read.
 */
async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === "string") return Buffer.from(body);

  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
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
  options: ExifServiceOptions,
): Promise<ExifServiceResult> {
  const { s3Client, bucket } = deps;
  const { filePath, includeReview } = options;

  // IPTC Digital Source Type – populated from embedded XMP or sidecar.
  let dst: { uri: string; label: string } | null = null;

  // C2PA manifest detection result – populated from container or sidecar.
  let c2paResult: { detected: boolean; label: string | null } | undefined;

  // ---- 1. Fetch initial byte range ----------------------------------------
  const s3Object = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: filePath,
      Range: `bytes=0-${INITIAL_RANGE_BYTES}`,
    }) as any,
  );

  let tiffPayload: Buffer | null = null;
  let combinedBuffer: Buffer | null = null;

  if (s3Object.Body) {
    const initialBuffer = await bodyToBuffer(s3Object.Body);

    // ---- 2. Bounded EXIF extraction with one follow-up --------------------
    tiffPayload = await extractExifWithRetry(
      initialBuffer,
      0,
      async (start: number, end: number) => {
        if (end - start + 1 > MAX_EXIF_BYTES) return null;
        try {
          const followUp = await s3Client.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: filePath,
              Range: `bytes=${start}-${end}`,
            }) as any,
          );
          return await bodyToBuffer(followUp.Body);
        } catch {
          return null;
        }
      },
    );

    // ---- 2b. Non-faststart (moov-at-end) video tail read -----------------
    // MOV/MP4 files without a faststart flag keep `moov` after `mdat`, past
    // the 256 KiB front window. Issuing a bounded tail read surfaces the
    // moov/udta/uuid EXIF payload that a front-only scan misses.
    if (!tiffPayload && isAnyIsoBmff(initialBuffer)) {
      try {
        const headResult = await s3Client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: filePath,
          }) as any,
        );
        const fileSize = headResult?.ContentLength;
        if (
          typeof fileSize === "number" &&
          fileSize > MAX_EXIF_BYTES &&
          Number.isFinite(fileSize)
        ) {
          const tailStart = fileSize - MAX_EXIF_BYTES;
          const tailObject = await s3Client.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: filePath,
              Range: `bytes=${tailStart}-${fileSize - 1}`,
            }) as any,
          );
          if (tailObject.Body) {
            const tailBuffer = await bodyToBuffer(tailObject.Body);
            const videoResult = extractExifFromIsoBmffVideo(
              tailBuffer,
              tailStart,
            );
            if (videoResult.tiff) {
              tiffPayload = videoResult.tiff;
            }
          }
        }
      } catch {
        // Tail read unavailable — leave tiffPayload null.
      }
    }

    // XMP is almost certainly in the initial range when EXIF was.
    combinedBuffer = initialBuffer;

    // ---- C2PA detection on initial buffer ---------
    c2paResult = await detectC2pa(initialBuffer);
  }

  // ---- C2PA sidecar fallback ---------------------------
  if (c2paResult && !c2paResult.detected) {
    try {
      const sidecarKey = filePath.replace(/\.(jpe?g|png)$/i, ".c2pa");
      if (sidecarKey !== filePath) {
        const sidecarObj = await s3Client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: sidecarKey,
          }) as any,
        );
        if (
          sidecarObj.Body &&
          (await bodyToBuffer(sidecarObj.Body)).length > 0
        ) {
          c2paResult = { detected: true, label: "c2pa-sidecar" };
        }
      }
    } catch {
      // Sidecar not found or inaccessible – not an error
    }
  } else if (c2paResult === undefined && combinedBuffer) {
    // If we didn't scan C2PA in the initial-buffer path (no Body),
    // try scanning the combined buffer.
    c2paResult = await detectC2pa(combinedBuffer);
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
          const followUp = await s3Client.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: filePath,
              Range: `bytes=${start}-${end}`,
            }) as any,
          );
          return await bodyToBuffer(followUp.Body);
        } catch {
          return null;
        }
      },
    );
  }

  if (!xmpXml) {
    try {
      const sidecar = await s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: `${filePath}.xmp`,
        }) as any,
      );
      if (sidecar.Body) {
        xmpXml = (await bodyToBuffer(sidecar.Body)).toString("utf-8") || null;
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
    const review = reviewExif(parsed, dst, c2paResult);

    return includeReview
      ? {
          exif: serialized,
          review,
          ...(c2paResult ? { c2pa: c2paResult } : {}),
        }
      : { exif: serialized };
  }

  return includeReview
    ? {
        exif: null,
        review: reviewExif(null, dst, c2paResult),
        ...(c2paResult ? { c2pa: c2paResult } : {}),
      }
    : { exif: null };
}
