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
 *
 * XMP (for IPTC Digital Source Type) lives in:
 *   - JPEG APP1 with signature "http://ns.adobe.com/xap/1.0/\0"
 *   - PNG iTXt chunk with keyword "XML:com.adobe.xmp"
 */

const JPEG_SOI = 0xffd8;
const JPEG_EOI = 0xffd9;
const JPEG_SOS = 0xffda; // Start of Scan – entropy-coded data follows, no length
const JPEG_APP1 = 0xffe1;
const EXIF_SIG = "Exif\0\0";
const XMP_SIG = "http://ns.adobe.com/xap/1.0/\0";

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

export interface XmpExtractResult {
  /** UTF-8 XMP XML string, or null if no XMP found. */
  xmpXml: string | null;
  /** True when XMP segment/chunk was found but extends beyond the buffer. */
  truncated: boolean;
  /** Total bytes needed (from buffer start) to capture the full XMP segment. */
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
// XMP extraction (JPEG APP1 and PNG iTXt)
// ---------------------------------------------------------------------------

/**
 * Extract XMP XML payload from a JPEG buffer.
 *
 * Walks JPEG markers from SOI and looks for APP1 with the XMP signature
 * "http://ns.adobe.com/xap/1.0/\0". Returns the XML text following the
 * signature, up to the segment end.
 *
 * Only the first XMP APP1 segment is returned (the XMP spec permits exactly
 * one "http://ns.adobe.com/xap/1.0/" APP1). ExtendedXMP (GContainer) is not
 * parsed.
 */
export function extractXmpFromJpeg(buffer: Buffer): XmpExtractResult {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== JPEG_SOI) {
    return { xmpXml: null, truncated: false, bytesNeeded: 0 };
  }

  let offset = 2;

  while (offset + 1 < buffer.length) {
    const markerHi = buffer[offset];

    if (markerHi !== 0xff) {
      break;
    }

    const markerLo = buffer[offset + 1];

    if (markerLo === 0x00 || markerLo === 0xff) {
      offset += 1;
      continue;
    }

    const marker = markerHi * 256 + markerLo;

    if (marker === JPEG_SOS) {
      break;
    }

    if (marker === JPEG_EOI) {
      break;
    }

    offset += 2;
    if (offset + 2 > buffer.length) {
      return {
        xmpXml: null,
        truncated: true,
        bytesNeeded: offset + 2,
      };
    }

    const length = buffer.readUInt16BE(offset);

    if (length < 2) {
      break;
    }

    const segmentDataStart = offset + 2;
    const segmentEnd = offset + length;

    if (segmentEnd > buffer.length) {
      return {
        xmpXml: null,
        truncated: true,
        bytesNeeded: segmentEnd,
      };
    }

    if (marker === JPEG_APP1) {
      // Check for XMP signature at the start of the complete segment.
      const xmpSigLen = XMP_SIG.length;
      if (
        segmentEnd - segmentDataStart >= xmpSigLen &&
        buffer.compare(
          Buffer.from(XMP_SIG, "ascii"),
          0,
          xmpSigLen,
          segmentDataStart,
          segmentDataStart + xmpSigLen
        ) === 0
      ) {
        // XMP XML payload starts after the signature.
        const xml = buffer.toString(
          "utf-8",
          segmentDataStart + xmpSigLen,
          segmentEnd
        );
        return {
          xmpXml: xml.trimEnd(),
          truncated: false,
          bytesNeeded: 0,
        };
      }
    }

    offset = segmentEnd;
  }

  return { xmpXml: null, truncated: false, bytesNeeded: 0 };
}

/**
 * Extract XMP XML payload from a PNG buffer.
 *
 * Walks PNG chunks looking for an iTXt chunk with keyword
 * "XML:com.adobe.xmp". iTXt format:
 *   - keyword (null-terminated ASCII)
 *   - compression flag (1 byte, must be 0 for XMP per XMP spec)
 *   - compression method (1 byte)
 *   - language tag (null-terminated)
 *   - translated keyword (null-terminated)
 *   - text data (UTF-8)
 */
export function extractXmpFromPng(buffer: Buffer): XmpExtractResult {
  if (buffer.length < 8 || !buffer.slice(0, 8).equals(PNG_SIGNATURE)) {
    return { xmpXml: null, truncated: false, bytesNeeded: 0 };
  }

  let offset = 8;

  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString("ascii", offset + 4, offset + 8);

    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    const nextOffset = dataEnd + 4; // +4 for CRC

    if (chunkLength > MAX_EXIF_BYTES) {
      break;
    }

    if (chunkType === "iTXt") {
      if (dataEnd <= buffer.length) {
        const result = parsePngItxtXmp(buffer, dataStart, dataEnd);
        if (result !== null) {
          return {
            xmpXml: result,
            truncated: false,
            bytesNeeded: 0,
          };
        }
      } else {
        return {
          xmpXml: null,
          truncated: true,
          bytesNeeded: dataEnd,
        };
      }
    }

    if (chunkType === "IEND") {
      break;
    }

    if (nextOffset <= offset) {
      break;
    }

    offset = nextOffset;
  }

  return { xmpXml: null, truncated: false, bytesNeeded: 0 };
}

/**
 * Parse an iTXt chunk data region and extract XMP if present.
 *
 * Returns the XMP XML string if the keyword matches "XML:com.adobe.xmp"
 * and the compression flag is 0 (uncompressed). Returns null otherwise.
 */
function parsePngItxtXmp(
  buffer: Buffer,
  dataStart: number,
  dataEnd: number
): string | null {
  let pos = dataStart;

  // Read null-terminated keyword.
  const keywordEnd = buffer.indexOf(0, pos);
  if (keywordEnd === -1 || keywordEnd >= dataEnd) return null;

  const keyword = buffer.toString("ascii", pos, keywordEnd);
  pos = keywordEnd + 1;

  if (keyword !== "XML:com.adobe.xmp") return null;

  // compression flag (1 byte)
  if (pos >= dataEnd) return null;
  const compressionFlag = buffer[pos];
  pos += 1;

  // compression method (1 byte)
  if (pos >= dataEnd) return null;
  pos += 1;

  // XMP spec: only uncompressed (flag=0) is valid for XMP data.
  if (compressionFlag !== 0) return null;

  // Skip null-terminated language tag.
  const langEnd = buffer.indexOf(0, pos);
  if (langEnd === -1 || langEnd >= dataEnd) return null;
  pos = langEnd + 1;

  // Skip null-terminated translated keyword.
  const transEnd = buffer.indexOf(0, pos);
  if (transEnd === -1 || transEnd >= dataEnd) return null;
  pos = transEnd + 1;

  // Remaining bytes are the UTF-8 text data.
  if (pos >= dataEnd) return null;
  return buffer.toString("utf-8", pos, dataEnd).trimEnd();
}

/**
 * Detect container format from magic bytes and extract the XMP XML payload.
 *
 * Returns the XMP XML string, or `null` if no XMP data is found or the
 * container is unrecognized.
 */
export function extractXmp(buffer: Buffer): string | null {
  if (buffer.length < 2) {
    return null;
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return extractXmpFromJpeg(buffer).xmpXml;
  }

  if (buffer.length >= 8 && buffer.slice(0, 8).equals(PNG_SIGNATURE)) {
    return extractXmpFromPng(buffer).xmpXml;
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

/**
 * Extract XMP with one bounded follow-up read.
 *
 * Same strategy as `extractExifWithRetry` but for XMP payloads.
 * Uses the same `initialOffset` / `fetchMore` pattern so callers can reuse
 * the combined buffer from the EXIF follow-up without a second S3 fetch.
 *
 * Returns the XMP XML string or null. Never throws on parse errors.
 */
export async function extractXmpWithRetry(
  initialBuffer: Buffer,
  initialOffset: number,
  fetchMore: FetchMoreBytes
): Promise<string | null> {
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

  let result: XmpExtractResult;
  if (isJpeg) {
    result = extractXmpFromJpeg(initialBuffer);
  } else {
    result = extractXmpFromPng(initialBuffer);
  }

  if (result.xmpXml) {
    return result.xmpXml;
  }

  if (!result.truncated || result.bytesNeeded <= 0) {
    return null;
  }

  const totalNeeded = initialOffset + result.bytesNeeded;
  if (totalNeeded > MAX_EXIF_BYTES) {
    return null;
  }

  const followStart = initialOffset + initialBuffer.length;
  const followEnd = MAX_EXIF_BYTES - 1;

  if (followStart > followEnd) {
    return null;
  }

  let followBytes: Buffer | null;
  try {
    followBytes = await fetchMore(followStart, followEnd);
  } catch {
    return null;
  }

  if (!followBytes || followBytes.length === 0) {
    return null;
  }

  const combined = Buffer.concat([initialBuffer, followBytes]);

  if (isJpeg) {
    result = extractXmpFromJpeg(combined);
  } else {
    result = extractXmpFromPng(combined);
  }

  return result.xmpXml;
}
