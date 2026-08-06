/**
 * Extract EXIF/TIFF payload from image containers (JPEG, PNG).
 *
 * exif-reader expects raw TIFF data (starting with "II" or "MM" byte-order
 * marker, or "Exif\0\0" + TIFF). The job of this module is to locate and
 * extract that payload from the container format so exif-reader can parse it.
 *
 * JPEG: EXIF lives in an APP1 (0xFFE1) marker segment that begins with the
 * ASCII signature "Exif\0\0". The TIFF payload follows immediately.
 *
 * PNG: EXIF lives in an optional "eXIf" chunk.
 */

const JPEG_SOI = 0xffd8;
const JPEG_EOI = 0xffd9;
const JPEG_SOS = 0xffda; // Start of Scan – entropy-coded data follows, no length
const JPEG_APP1 = 0xffe1;
const EXIF_SIG = "Exif\0\0";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Hard cap on total bytes read for EXIF scanning (256 KiB). */
export const MAX_EXIF_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface JpegExtractResult {
  tiff: Buffer | null;
  /** True when an APP1+Exif segment was found but extends beyond the buffer. */
  truncated: boolean;
  /** Total bytes needed (from buffer start) to capture the full EXIF segment. */
  bytesNeeded: number;
}

export interface PngExtractResult {
  tiff: Buffer | null;
  /** True when an eXIf chunk was found but extends beyond the buffer. */
  truncated: boolean;
  /** Total bytes needed (from buffer start) to capture the full eXIf chunk. */
  bytesNeeded: number;
}

// ---------------------------------------------------------------------------
// JPEG extraction
// ---------------------------------------------------------------------------

/**
 * Extract the raw TIFF/EXIF payload from a JPEG buffer.
 *
 * Walks JPEG markers from SOI. When it finds APP1 with the "Exif\0\0"
 * signature, extracts the TIFF data following that signature and returns it.
 * Stops at SOS or EOI without finding EXIF.
 *
 * Returns `{ tiff: null, truncated: false }` when:
 *  - No APP1/EXIF segment is found before SOS/EOI
 *  - The buffer does not start with SOI
 *  - A non-EXIF segment's declared length extends beyond the buffer
 *  - The buffer is too short to contain valid markers
 *
 * Returns `{ tiff: null, truncated: true }` when an EXIF-bearing APP1
 * segment was found but its declared length extends beyond the buffer.
 * `bytesNeeded` indicates the total bytes required to capture it.
 */
export function extractExifFromJpeg(buffer: Buffer): JpegExtractResult {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== JPEG_SOI) {
    return { tiff: null, truncated: false, bytesNeeded: 0 };
  }

  let offset = 2;

  while (offset + 1 < buffer.length) {
    const markerHi = buffer[offset];

    // JPEG markers are 0xFF followed by a non-zero, non-0xFF byte.
    if (markerHi !== 0xff) {
      break;
    }

    const markerLo = buffer[offset + 1];

    // 0xFF 0x00 = stuffed byte in entropy-coded data, not a marker.
    // 0xFF 0xFF = padding byte, not a marker.
    if (markerLo === 0x00 || markerLo === 0xff) {
      offset += 1;
      continue;
    }

    const marker = markerHi * 256 + markerLo;

    // Stop at SOS – entropy-coded data follows, no length field.
    if (marker === JPEG_SOS) {
      break;
    }

    // Stop at EOI.
    if (marker === JPEG_EOI) {
      break;
    }

    // All other markers have a 2-byte big-endian length field.
    offset += 2;
    if (offset + 2 > buffer.length) {
      // The range ended between the marker and its length field. A bounded
      // follow-up may reveal a valid EXIF segment.
      return {
        tiff: null,
        truncated: true,
        bytesNeeded: offset + 2,
      };
    }

    const length = buffer.readUInt16BE(offset);

    // Length includes the 2 length bytes, so minimum valid length is 2.
    if (length < 2) {
      break;
    }

    const segmentDataStart = offset + 2;
    const segmentEnd = offset + length;

    if (segmentEnd > buffer.length) {
      // This may be APP1 cut off before its signature, or another segment that
      // must be skipped before a later APP1. Ask for one bounded continuation.
      return {
        tiff: null,
        truncated: true,
        bytesNeeded: segmentEnd,
      };
    }

    if (marker === JPEG_APP1) {
      // Check for "Exif\0\0" signature at the start of the complete segment.
      const sig = buffer.toString(
        "ascii",
        segmentDataStart,
        segmentDataStart + 6
      );
      if (sig === EXIF_SIG) {
        // TIFF payload starts after the 6-byte "Exif\0\0" signature.
        return {
          tiff: buffer.slice(segmentDataStart + 6, segmentEnd),
          truncated: false,
          bytesNeeded: 0,
        };
      }
    }

    offset = segmentEnd;
  }

  return { tiff: null, truncated: false, bytesNeeded: 0 };
}

// ---------------------------------------------------------------------------
// PNG extraction
// ---------------------------------------------------------------------------

/**
 * Extract the raw EXIF payload from a PNG buffer.
 *
 * Walks PNG chunks looking for "eXIf". The eXIf chunk data follows the same
 * format as JPEG APP1 EXIF data: "Exif\0\0" + TIFF. exif-reader handles both
 * the prefixed and unprefixed forms, so we pass the chunk data as-is.
 *
 * Returns `{ tiff: null, truncated: false }` when no eXIf chunk is found or
 * the buffer is invalid.
 *
 * Returns `{ tiff: null, truncated: true }` when an eXIf chunk was found
 * but extends beyond the buffer.
 */
export function extractExifFromPng(buffer: Buffer): PngExtractResult {
  if (buffer.length < 8 || !buffer.slice(0, 8).equals(PNG_SIGNATURE)) {
    return { tiff: null, truncated: false, bytesNeeded: 0 };
  }

  let offset = 8;

  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString("ascii", offset + 4, offset + 8);

    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    const nextOffset = dataEnd + 4; // +4 for CRC

    // Guard against massive chunk lengths from malformed input.
    if (chunkLength > MAX_EXIF_BYTES) {
      break;
    }

    if (chunkType === "eXIf") {
      if (dataEnd <= buffer.length) {
        return {
          tiff: buffer.slice(dataStart, dataEnd),
          truncated: false,
          bytesNeeded: 0,
        };
      }
      // eXIf chunk extends beyond buffer.
      return {
        tiff: null,
        truncated: true,
        bytesNeeded: dataEnd,
      };
    }

    if (chunkType === "IEND") {
      break;
    }

    // Guard: don't loop forever on malformed data.
    if (nextOffset <= offset) {
      break;
    }

    offset = nextOffset;
  }

  return { tiff: null, truncated: false, bytesNeeded: 0 };
}

/**
 * Detect container format from magic bytes and extract the EXIF payload.
 *
 * Returns the raw TIFF/EXIF Buffer suitable for passing to exif-reader,
 * or `null` if no EXIF data is found or the container is unrecognized.
 *
 * This is the simple extraction path that does not signal truncation;
 * use `extractExifWithTruncation` if you need to implement bounded
 * follow-up reads.
 */
export function extractExif(buffer: Buffer): Buffer | null {
  if (buffer.length < 2) {
    return null;
  }

  // JPEG detection: starts with 0xFF 0xD8
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return extractExifFromJpeg(buffer).tiff;
  }

  // PNG detection: starts with 8-byte PNG signature
  if (buffer.length >= 8 && buffer.slice(0, 8).equals(PNG_SIGNATURE)) {
    return extractExifFromPng(buffer).tiff;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Bounded-retry extraction (for controller use)
// ---------------------------------------------------------------------------

export type FetchMoreBytes = (
  start: number,
  end: number
) => Promise<Buffer | null>;

/**
 * Extract EXIF with one bounded follow-up read.
 *
 * The strategy:
 *  1. Attempt extraction from the initial buffer.
 *  2. If a valid EXIF segment was found but extends beyond the buffer,
 *     fetch the missing bytes (capped at MAX_EXIF_BYTES total).
 *  3. Retry extraction from the combined buffer.
 *
 * Returns the TIFF payload or null. Never throws on parse errors.
 */
export async function extractExifWithRetry(
  initialBuffer: Buffer,
  initialOffset: number,
  fetchMore: FetchMoreBytes
): Promise<Buffer | null> {
  // Detect container type from magic bytes.
  if (initialBuffer.length < 2) {
    return null;
  }

  const isJpeg = initialBuffer[0] === 0xff && initialBuffer[1] === 0xd8;
  const isPng =
    initialBuffer.length >= 8 &&
    initialBuffer.slice(0, 8).equals(PNG_SIGNATURE);

  if (!isJpeg && !isPng) {
    return null;
  }

  // Try extraction.
  let result: JpegExtractResult | PngExtractResult;
  if (isJpeg) {
    result = extractExifFromJpeg(initialBuffer);
  } else {
    result = extractExifFromPng(initialBuffer);
  }

  if (result.tiff) {
    return result.tiff;
  }

  if (!result.truncated || result.bytesNeeded <= 0) {
    return null;
  }

  // Check hard cap.
  const totalNeeded = initialOffset + result.bytesNeeded;
  if (totalNeeded > MAX_EXIF_BYTES) {
    return null;
  }

  // Fetch the remainder of the bounded scan window in one request. Fetching
  // only `bytesNeeded` could reveal the segment length but still leave the
  // signature or segment body truncated, which would require a forbidden
  // second follow-up.
  const followStart = initialOffset + initialBuffer.length;
  const followEnd = MAX_EXIF_BYTES - 1; // Range header is inclusive.

  if (followStart > followEnd) {
    return null;
  }

  // Fetch missing bytes.
  let followBytes: Buffer | null;
  try {
    followBytes = await fetchMore(followStart, followEnd);
  } catch {
    return null;
  }

  if (!followBytes || followBytes.length === 0) {
    return null;
  }

  // Combine and retry.
  const combined = Buffer.concat([initialBuffer, followBytes]);

  if (isJpeg) {
    result = extractExifFromJpeg(combined);
  } else {
    result = extractExifFromPng(combined);
  }

  return result.tiff;
}
