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

export interface HeifExtractResult {
  tiff: Buffer | null;
  /** True when an Exif item was found but extends beyond the buffer. */
  truncated: boolean;
  /** Total bytes needed (from buffer start) to capture the full EXIF item. */
  bytesNeeded: number;
}

export interface IsoBmffVideoExtractResult {
  tiff: Buffer | null;
  /** True when an Exif item was found but extends beyond the buffer. */
  truncated: boolean;
  /** Total bytes needed (from buffer start) to capture the full EXIF item. */
  bytesNeeded: number;
  /** Set when the buffer contains no moov box at all (non-faststart hint). */
  moovMissing: boolean;
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
        segmentDataStart + 6,
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

  // HEIF/HEIC/MP4/MOV detection: ISO BMFF container with ftyp box.
  if (isAnyIsoBmff(buffer)) {
    // Try HEIF photo path first (top-level meta box).
    const heifResult = extractExifFromHeif(buffer);
    if (heifResult.tiff) return heifResult.tiff;

    // Fall back to video path (moov → udta → uuid).
    return extractExifFromIsoBmffVideo(buffer).tiff;
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
          segmentDataStart + xmpSigLen,
        ) === 0
      ) {
        // XMP XML payload starts after the signature.
        const xml = buffer.toString(
          "utf-8",
          segmentDataStart + xmpSigLen,
          segmentEnd,
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
  dataEnd: number,
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
// HEIF / HEIC extraction (ISO Base Media File Format / BMFF)
// ---------------------------------------------------------------------------

// HEIF files start with an ftyp box containing a brand like "heic", "mif1",
// "heix", "heim", "heis", "hevc", "avif", etc.
// Video containers (MP4, MOV) use the same ISO BMFF container format with
// different ftyp brands.
const HEIF_BRANDS = ["heic", "mif1", "heix", "heim", "heis", "hevc", "avif"];
const VIDEO_BMFF_BRANDS = ["mp42", "mp41", "isom", "qt  ", "MSNV", "avc1"];
const ALL_ISO_BMFF_BRANDS = [...HEIF_BRANDS, ...VIDEO_BMFF_BRANDS];

/**
 * Apple metadata UUID for the uuid box under moov/udta that wraps a
 * MetaBox containing iloc/iinf pointing to the EXIF payload.
 * UUID: 85C0B687-F45C-46DA-9D5D-9F9049B8E2AE
 */
const APPLE_METADATA_UUID = Buffer.from([
  0x85, 0xc0, 0xb6, 0x87, 0xf4, 0x5c, 0x46, 0xda, 0x9d, 0x5d, 0x9f, 0x90, 0x49,
  0xb8, 0xe2, 0xae,
]);

const HEIF_FTYP_BOX = "ftyp";
const HEIF_META_BOX = "meta";
const HEIF_ILOC_BOX = "iloc";
const HEIF_IINF_BOX = "iinf";
const HEIF_INFE_BOX = "infe";

/** Box header result. */
interface BoxHeader {
  type: string;
  /** Offset of box data (after header). */
  dataStart: number;
  /** Offset of first byte past this box (dataStart + dataSize). */
  end: number;
  /** Size of the box data in bytes (total box size minus header). */
  dataSize: number;
}

/**
 * Read a BMFF box header at the given offset.
 *
 * Box header: [4-byte size][4-byte type][optional 8-byte extended size].
 * - size == 0: box extends to end of buffer
 * - size == 1: 8-byte extended size follows
 * - size >= 8: normal box (size includes the 4-byte size + 4-byte type)
 *
 * Returns null if the header can't be read.
 */
function readBoxHeader(buffer: Buffer, offset: number): BoxHeader | null {
  if (offset + 8 > buffer.length) return null;

  let size = buffer.readUInt32BE(offset);
  const type = buffer.toString("ascii", offset + 4, offset + 8);
  let headerSize = 8;

  if (size === 1) {
    // Extended size: next 8 bytes are uint64 BE.
    if (offset + 16 > buffer.length) return null;
    const hi = buffer.readUInt32BE(offset + 8);
    const lo = buffer.readUInt32BE(offset + 12);
    // Guard: JS Number can only represent integers up to 2^53 safely.
    if (hi > 0x001fffff) {
      // Box is > 2^53 bytes — unrealistic, bail.
      return null;
    }
    size = hi * 0x100000000 + lo;
    headerSize = 16;
  }

  if (size === 0) {
    // Box extends to end of buffer.
    return {
      type,
      dataStart: offset + headerSize,
      end: buffer.length,
      dataSize: buffer.length - offset - headerSize,
    };
  }

  if (size < headerSize) {
    // Malformed: box can't be smaller than its header.
    return null;
  }

  return {
    type,
    dataStart: offset + headerSize,
    end: offset + size,
    dataSize: size - headerSize,
  };
}

/**
 * Check whether the buffer starts with a recognizable ISO BMFF ftyp box
 * (HEIF/HEIC/AVIF or MP4/MOV video).
 */
export function isHeif(buffer: Buffer): boolean {
  return isIsoBmff(buffer, HEIF_BRANDS);
}

/**
 * Check whether the buffer starts with an ISO BMFF container with one of the
 * given compatible brands.
 */
export function isIsoBmff(buffer: Buffer, brands: string[]): boolean {
  if (buffer.length < 12) return false;
  // First 4 bytes: box size (or 1 for extended)
  let off = 0;
  const boxSize = buffer.readUInt32BE(0);
  if (boxSize === 1) {
    if (buffer.length < 16) return false;
    off = 8;
  } else if (boxSize < 8) {
    return false;
  }
  // Check box type = "ftyp"
  const type = buffer.toString("ascii", 4 + off, 8 + off);
  if (type !== HEIF_FTYP_BOX) return false;
  // Check brand at offset 8 + headerSize
  const brandStart = 8 + (boxSize === 1 ? 8 : 0);
  if (brandStart + 4 > buffer.length) return false;
  const brand = buffer.toString("ascii", brandStart, brandStart + 4);
  return brands.includes(brand);
}

/**
 * Check whether the buffer starts with an ISO BMFF container
 * (HEIF/HEIC/AVIF or MP4/MOV video).
 */
export function isAnyIsoBmff(buffer: Buffer): boolean {
  return isIsoBmff(buffer, ALL_ISO_BMFF_BRANDS);
}

/**
 * Check whether the buffer starts with a video ISO BMFF container
 * (MP4, MOV, etc. — not HEIF/HEIC/AVIF).
 */
export function isVideoIsoBmff(buffer: Buffer): boolean {
  return isIsoBmff(buffer, VIDEO_BMFF_BRANDS);
}

/**
 * Parse duration in seconds from the mvhd box inside moov.
 *
 * Walks the ISO BMFF box hierarchy:
 *   ftyp → skip
 *   moov → mvhd → parse version 0 or v1
 *
 * Returns null when:
 *  - Not a video ISO BMFF container
 *  - moov/mvhd not found within the buffer
 *  - mvhd version is unknown (only v0/v1 supported)
 *  - timescale is zero
 *  - v1 duration exceeds JS safe integer range
 */
export function extractDuration(buffer: Buffer): number | null {
  if (!isVideoIsoBmff(buffer)) return null;

  // Walk top-level boxes looking for moov
  let moovHeader: BoxHeader | null = null;
  findChildBox(buffer, 0, buffer.length, "moov", (h) => {
    moovHeader = h;
    return h;
  });

  if (!moovHeader) return null;

  // moov extends Box (not FullBox) — children start right after the header
  const moovChildrenStart = moovHeader.dataStart;
  if (moovChildrenStart > moovHeader.end) return null;

  let durationResult: number | null = null;
  findChildBox(buffer, moovChildrenStart, moovHeader.end, "mvhd", (h) => {
    // mvhd is a full box: version(1) + flags(3) = 4 bytes
    if (h.dataStart + 4 > h.end) return null;
    const version = buffer[h.dataStart];

    if (version === 0) {
      // v0: timescale at dataStart+12, duration at dataStart+16
      if (h.dataStart + 20 > h.end) return null;
      const timescale = buffer.readUInt32BE(h.dataStart + 12);
      const durationRaw = buffer.readUInt32BE(h.dataStart + 16);
      if (timescale === 0) return null;
      durationResult = durationRaw / timescale;
      return durationResult;
    }

    if (version === 1) {
      // v1: timescale at dataStart+20, duration at dataStart+24 (64-bit)
      if (h.dataStart + 32 > h.end) return null;
      const timescale = buffer.readUInt32BE(h.dataStart + 20);
      const hi = buffer.readUInt32BE(h.dataStart + 24);
      const lo = buffer.readUInt32BE(h.dataStart + 28);
      // Guard: JS Number safe integer range
      if (hi > 0x001fffff) return null;
      const durationRaw = hi * 0x100000000 + lo;
      if (timescale === 0) return null;
      durationResult = durationRaw / timescale;
      return durationResult;
    }

    return null; // unknown version
  });

  return durationResult;
}

/**
 * Walk the direct children of a parent box, calling visitor for each child
 * of the given type. Stops when visitor returns non-null.
 */
function findChildBox<T>(
  buffer: Buffer,
  parentStart: number,
  parentEnd: number,
  boxType: string,
  visitor: (header: BoxHeader) => T | null,
): T | null {
  let off = parentStart;
  while (off + 8 <= parentEnd) {
    const header = readBoxHeader(buffer, off);
    if (!header || header.end > parentEnd) break;

    if (header.type === boxType) {
      const result = visitor(header);
      if (result !== null) return result;
    }

    // Move past this box.
    off = header.end;
    if (off <= parentStart) break; // safety
  }
  return null;
}

/**
 * Extract the raw TIFF/EXIF payload from a HEIF/HEIC buffer.
 *
 * HEIF uses the ISOBMFF container:
 *  - ftyp box (first) identifies the brand
 *  - meta box contains iloc (item locations), iinf (item info), iprp (props)
 *  - iinf lists items; one has item_type == "Exif"
 *  - iloc maps item IDs to offsets within mdat (or idat)
 *  - The offset points to a TIFF header (often prefixed with 4 zero bytes + "Exif")
 *
 * This implementation:
 *  1. Validates the ftyp brand
 *  2. Finds the meta box
 *  3. Reads iloc to build an offset map (item_ID → { offset, length })
 *  4. Reads iinf to find the Exif item_ID
 *  5. Extracts the payload from mdat/idat at the iloc offset
 */
export function extractExifFromHeif(buffer: Buffer): HeifExtractResult {
  if (!isAnyIsoBmff(buffer)) {
    return { tiff: null, truncated: false, bytesNeeded: 0 };
  }

  // Locate the top-level meta box (HEIF photo layout).
  const ftypHeader = readBoxHeader(buffer, 0);
  if (!ftypHeader) return { tiff: null, truncated: false, bytesNeeded: 0 };

  let metaHeader: BoxHeader | null = null;
  findChildBox(buffer, ftypHeader.end, buffer.length, HEIF_META_BOX, (h) => {
    metaHeader = h;
    return h; // signal found
  });

  if (!metaHeader) {
    return { tiff: null, truncated: false, bytesNeeded: 0 };
  }

  // The meta box is a full box (4 bytes version+flags), so children
  // start at dataStart + 4, not dataStart.
  return extractExifFromMetaChildren(
    buffer,
    metaHeader.dataStart + 4,
    metaHeader.end,
    0,
  );
}

/** A single iloc (ItemLocation) entry pointing at an item's payload bytes. */
interface IlocEntry {
  itemId: number;
  /** Absolute file offset of the payload (construction method 0). */
  offset: number;
  length: number;
}

/**
 * Parse an iloc (ItemLocation) box, returning the file-offset entries.
 *
 * Returns null for malformed input or when no file-offset (construction
 * method 0) entries are present.
 */
function parseIloc(buffer: Buffer, header: BoxHeader): IlocEntry[] | null {
  // iloc is a full box (4-byte version/flags after header).
  let off = header.dataStart;
  if (off + 4 > header.end) return null;
  const version = buffer[off];
  off += 4;

  // version 0/1/2 differ in field widths.
  const offsetSize = (buffer[off] >> 4) & 0x0f;
  const lengthSize = buffer[off] & 0x0f;
  const baseOffsetSize = (buffer[off + 1] >> 4) & 0x0f;
  off += 2;

  let itemCount: number;
  if (version < 2) {
    if (off + 2 > header.end) return null;
    itemCount = buffer.readUInt16BE(off);
    off += 2;
  } else {
    if (off + 4 > header.end) return null;
    itemCount = buffer.readUInt32BE(off);
    off += 4;
  }

  const entries: IlocEntry[] = [];
  for (let i = 0; i < itemCount; i++) {
    let itemId: number;
    if (version < 2) {
      if (off + 2 > header.end) return null;
      itemId = buffer.readUInt16BE(off);
      off += 2;
    } else {
      if (off + 4 > header.end) return null;
      itemId = buffer.readUInt32BE(off);
      off += 4;
    }

    // construction method: version 1+ has 2 bits reserved, then
    // construction_method in low 4 bits of a 2-byte field.
    let constructionMethod = 0;
    if (version >= 1) {
      if (off + 2 > header.end) return null;
      constructionMethod = buffer.readUInt16BE(off) & 0x000f;
      off += 2;
    }

    if (off + 2 > header.end) return null;
    buffer.readUInt16BE(off); // dataReferenceIndex
    off += 2;

    let baseOffset = 0;
    if (baseOffsetSize > 0) {
      if (off + baseOffsetSize > header.end) return null;
      baseOffset = buffer.readUIntBE(off, baseOffsetSize);
      off += baseOffsetSize;
    }

    if (off + 2 > header.end) return null;
    const extentCount = buffer.readUInt16BE(off);
    off += 2;

    let extentOffset = 0;
    let extentLength = 0;

    for (let e = 0; e < extentCount; e++) {
      if (
        (offsetSize > 0 && off + offsetSize > header.end) ||
        (lengthSize > 0 && off + offsetSize + lengthSize > header.end)
      ) {
        return null;
      }
      if (offsetSize > 0) {
        extentOffset = buffer.readUIntBE(off, offsetSize);
        off += offsetSize;
      }
      if (lengthSize > 0) {
        extentLength = buffer.readUIntBE(off, lengthSize);
        off += lengthSize;
      }
    }

    // Only file-offset items (construction method 0).
    if (constructionMethod === 0 && extentLength > 0) {
      entries.push({
        itemId,
        offset: baseOffset + extentOffset,
        length: extentLength,
      });
    }
  }

  return entries;
}

/**
 * Parse an iinf (ItemInfo) box and return the item ID whose item_type is
 * "Exif", or null if no Exif item is present.
 */
function findExifItemId(buffer: Buffer, header: BoxHeader): number | null {
  // iinf is a full box.
  let off = header.dataStart;
  if (off + 4 > header.end) return null;
  const version = buffer[off];
  off += 4;

  let entryCount: number;
  if (version === 0) {
    if (off + 2 > header.end) return null;
    entryCount = buffer.readUInt16BE(off);
    off += 2;
  } else {
    if (off + 4 > header.end) return null;
    entryCount = buffer.readUInt32BE(off);
    off += 4;
  }

  const iinfEnd = header.end;

  for (let i = 0; i < entryCount; i++) {
    if (off + 8 > iinfEnd) return null;
    // Read infe header.
    const infeHeader = readBoxHeader(buffer, off);
    if (!infeHeader || infeHeader.type !== HEIF_INFE_BOX) {
      // Unexpected — may be a different box type.
      break;
    }

    // infe is a full box.
    let infeOff = infeHeader.dataStart;
    if (infeOff + 4 > infeHeader.end) return null;
    const infeVersion = buffer[infeOff];
    infeOff += 4;

    let itemId: number;
    if (infeVersion >= 2) {
      if (infeOff + 4 > infeHeader.end) return null;
      itemId = buffer.readUInt32BE(infeOff);
      infeOff += 4;
    } else {
      if (infeOff + 2 > infeHeader.end) return null;
      itemId = buffer.readUInt16BE(infeOff);
      infeOff += 2;
    }

    if (infeVersion >= 2) {
      if (infeOff + 2 > infeHeader.end) return null;
      // itemProtectionIndex — read but not used for EXIF detection.
      buffer.readUInt16BE(infeOff);
      infeOff += 2;
    }

    // item_type: 4-char code.
    if (infeOff + 4 > infeHeader.end) return null;
    const itemType = buffer.toString("ascii", infeOff, infeOff + 4);

    if (itemType === "Exif" || itemType === "exif") {
      return itemId;
    }

    // Move to next infe.
    off = infeHeader.end;
  }

  return null;
}

/**
 * Shared ISO BMFF MetaBox payload extraction, used by both the HEIF photo
 * path (top-level meta) and the Apple video path (meta inside moov/udta/uuid).
 *
 * `metaChildrenStart`/`metaChildrenEnd` delimit the children of a meta full
 * box (i.e. after the 4-byte version/flags). `baseOffset` is the absolute
 * file offset of `buffer[0]` — 0 for front reads, nonzero for tail reads —
 * used to translate iloc file offsets into buffer-local offsets.
 */
function extractExifFromMetaChildren(
  buffer: Buffer,
  metaChildrenStart: number,
  metaChildrenEnd: number,
  baseOffset: number,
): { tiff: Buffer | null; truncated: boolean; bytesNeeded: number } {
  // ---- 1. Parse iloc (Item Location Box) ----
  let ilocEntries: IlocEntry[] | null = null;
  findChildBox(
    buffer,
    metaChildrenStart,
    metaChildrenEnd,
    HEIF_ILOC_BOX,
    (h) => {
      ilocEntries = parseIloc(buffer, h);
      return ilocEntries; // signal found
    },
  );

  if (!ilocEntries || ilocEntries.length === 0) {
    console.error(
      "[DBG] meta children: no iloc entries",
      metaChildrenStart,
      metaChildrenEnd,
    );
    return { tiff: null, truncated: false, bytesNeeded: 0 };
  }

  // ---- 2. Parse iinf (Item Information Box) to find Exif item ID ----
  let exifItemId: number | null = null;
  findChildBox(
    buffer,
    metaChildrenStart,
    metaChildrenEnd,
    HEIF_IINF_BOX,
    (h) => {
      exifItemId = findExifItemId(buffer, h);
      return exifItemId; // signal found
    },
  );

  if (exifItemId === null) {
    console.error("[DBG] meta children: no exif item id");
    return { tiff: null, truncated: false, bytesNeeded: 0 };
  }

  // ---- 3. Look up the offset in iloc entries ----
  const entry = ilocEntries.find((e) => e.itemId === exifItemId);
  if (!entry) {
    console.error(
      "[DBG] meta children: no entry for item",
      exifItemId,
      JSON.stringify(ilocEntries),
    );
    return { tiff: null, truncated: false, bytesNeeded: 0 };
  }
  console.error(
    "[DBG] meta children: entry",
    JSON.stringify(entry),
    "baseOffset",
    baseOffset,
  );

  // ---- 4. Translate the absolute file offset into a buffer-local offset ----
  const localStart = entry.offset - baseOffset;
  const localEnd = localStart + entry.length;

  // ---- 5. Check truncation / out-of-window ----
  if (localStart < 0 || localEnd > buffer.length) {
    return {
      tiff: null,
      truncated: true,
      bytesNeeded: Math.max(0, localEnd),
    };
  }

  // ---- 6. Extract TIFF payload ----
  // The Exif item often starts with a 4-byte zero prefix + "Exif" + padding,
  // followed by the TIFF header. findTiffStart locates "II*\0" or "MM*\0".
  const tiffStart = findTiffStart(buffer, localStart, localEnd);
  if (tiffStart === -1) {
    // No TIFF marker found — return the data as-is for exif-reader to try.
    return {
      tiff: buffer.slice(localStart, localEnd),
      truncated: false,
      bytesNeeded: 0,
    };
  }

  return {
    tiff: buffer.slice(tiffStart, localEnd),
    truncated: false,
    bytesNeeded: 0,
  };
}

/**
 * Walk the direct children of a container looking for "uuid" boxes, calling
 * `visitor` for each with the resolved payload range (after the 24-byte
 * size+type+usertype header) and the 16-byte usertype value. Stops when the
 * visitor returns a non-null value.
 */
function findUuidBox<T>(
  buffer: Buffer,
  parentStart: number,
  parentEnd: number,
  visitor: (dataStart: number, dataEnd: number, uuid: Buffer) => T | null,
): T | null {
  let off = parentStart;
  while (off + 8 <= parentEnd) {
    const header = readBoxHeader(buffer, off);
    if (!header || header.end > parentEnd) break;

    if (header.type === "uuid") {
      // uuid box: [size][type="uuid"][16-byte usertype][payload]
      const usertypeStart = off + 8;
      const payloadStart = off + 24;
      if (payloadStart <= header.end) {
        const uuid = buffer.slice(usertypeStart, payloadStart);
        const result = visitor(payloadStart, header.end, uuid);
        if (result !== null) return result;
      }
    }

    off = header.end;
    if (off <= parentStart) break; // safety
  }
  return null;
}

/**
 * Find a MetaBox inside a uuid box payload and extract its Exif item.
 */
function extractExifFromUuidPayload(
  buffer: Buffer,
  uuidDataStart: number,
  uuidDataEnd: number,
  baseOffset: number,
): { tiff: Buffer | null; truncated: boolean; bytesNeeded: number } {
  let metaHeader: BoxHeader | null = null;
  findChildBox(buffer, uuidDataStart, uuidDataEnd, HEIF_META_BOX, (h) => {
    metaHeader = h;
    return h;
  });

  if (!metaHeader) {
    return { tiff: null, truncated: false, bytesNeeded: 0 };
  }

  return extractExifFromMetaChildren(
    buffer,
    metaHeader.dataStart + 4,
    metaHeader.end,
    baseOffset,
  );
}

/**
 * Extract the raw TIFF/EXIF payload from an Apple MOV/MP4 video container.
 *
 * Apple stores video EXIF in a uuid box under moov/udta:
 *
 *   moov → udta → uuid (85C0B687-...) → MetaBox { hdlr, iloc, iinf }
 *
 * The uuid box wraps a standard ISO BMFF MetaBox whose iloc/iinf describe an
 * Exif item exactly like the HEIF photo path — except the MetaBox lives under
 * moov/udta rather than at the top level.
 *
 * `baseOffset` is the absolute file offset of `buffer[0]` (default 0). When
 * extracting from a tail read of a non-faststart file, pass the tail start so
 * iloc file offsets are translated correctly.
 */
export function extractExifFromIsoBmffVideo(
  buffer: Buffer,
  baseOffset: number = 0,
): IsoBmffVideoExtractResult {
  if (!isAnyIsoBmff(buffer)) {
    // The buffer doesn't start with a valid ftyp — this happens on tail
    // reads of non-faststart files, where the read begins mid-box (inside
    // mdat padding). Scan for a moov box header anywhere in the buffer and
    // parse from there; the moov is fully contained even when the mdat
    // before it is truncated.
    return findMoovInTruncatedBuffer(buffer, baseOffset);
  }

  const ftypHeader = readBoxHeader(buffer, 0);
  if (!ftypHeader) {
    return { tiff: null, truncated: false, bytesNeeded: 0, moovMissing: false };
  }

  // ---- 1. Find moov ----
  let moovHeader: BoxHeader | null = null;
  findChildBox(buffer, ftypHeader.end, buffer.length, "moov", (h) => {
    moovHeader = h;
    return h;
  });

  if (!moovHeader) {
    // No moov box in this buffer — a non-faststart hint when reading the
    // front of the file, or a genuinely absent moov.
    return { tiff: null, truncated: false, bytesNeeded: 0, moovMissing: true };
  }

  return extractFromMoov(buffer, moovHeader, baseOffset);
}

/**
 * Parse udta → uuid → meta → Exif out of a located moov box.
 */
function extractFromMoov(
  buffer: Buffer,
  moovHeader: BoxHeader,
  baseOffset: number,
): IsoBmffVideoExtractResult {
  // ---- 2. Find udta inside moov ----
  let udtaHeader: BoxHeader | null = null;
  findChildBox(buffer, moovHeader.dataStart, moovHeader.end, "udta", (h) => {
    udtaHeader = h;
    return h;
  });

  if (!udtaHeader) {
    return { tiff: null, truncated: false, bytesNeeded: 0, moovMissing: false };
  }

  // ---- 3. Find the Apple metadata uuid box and extract its MetaBox Exif ----
  // Prefer the known Apple metadata UUID; fall back to any uuid box that
  // carries a MetaBox with an Exif item (robustness against UUID changes).
  const appleResult = findUuidBox(
    buffer,
    udtaHeader.dataStart,
    udtaHeader.end,
    (payloadStart, payloadEnd, uuid) => {
      if (!uuid.equals(APPLE_METADATA_UUID)) return null;
      return extractExifFromUuidPayload(
        buffer,
        payloadStart,
        payloadEnd,
        baseOffset,
      );
    },
  );

  if (appleResult && (appleResult.tiff || appleResult.truncated)) {
    return {
      tiff: appleResult.tiff,
      truncated: appleResult.truncated,
      bytesNeeded: appleResult.bytesNeeded,
      moovMissing: false,
    };
  }

  // Fallback probe: any uuid box containing a usable MetaBox.
  const fallbackResult = findUuidBox(
    buffer,
    udtaHeader.dataStart,
    udtaHeader.end,
    (payloadStart, payloadEnd) =>
      extractExifFromUuidPayload(buffer, payloadStart, payloadEnd, baseOffset),
  );

  if (fallbackResult && (fallbackResult.tiff || fallbackResult.truncated)) {
    return {
      tiff: fallbackResult.tiff,
      truncated: fallbackResult.truncated,
      bytesNeeded: fallbackResult.bytesNeeded,
      moovMissing: false,
    };
  }

  // Last-resort probe: some Apple files store the EXIF as a raw TIFF blob
  // inside the Apple metadata uuid without a parseable iloc/iinf MetaBox.
  // Scan the Apple uuid payload for a TIFF byte-order marker. Restricted to
  // the Apple UUID to avoid false positives on unrelated uuid box types
  // (e.g. XMP uuid boxes carrying arbitrary binary data).
  const rawResult = findUuidBox(
    buffer,
    udtaHeader.dataStart,
    udtaHeader.end,
    (payloadStart, payloadEnd, uuid) => {
      if (!uuid.equals(APPLE_METADATA_UUID)) return null;
      const tiffStart = findTiffStart(buffer, payloadStart, payloadEnd);
      if (tiffStart === -1) return null;
      return {
        tiff: buffer.slice(tiffStart, payloadEnd),
        truncated: false,
        bytesNeeded: 0,
      };
    },
  );

  if (rawResult) {
    return {
      tiff: rawResult.tiff,
      truncated: false,
      bytesNeeded: 0,
      moovMissing: false,
    };
  }

  return { tiff: null, truncated: false, bytesNeeded: 0, moovMissing: false };
}

/**
 * Scan for a TIFF byte-order marker ("II" or "MM" followed by 0x2A 0x00).
 * Returns the offset of the marker, or -1 if not found.
 */
function findTiffStart(buffer: Buffer, start: number, end: number): number {
  for (let i = start; i + 4 <= end; i++) {
    if (
      (buffer[i] === 0x49 && buffer[i + 1] === 0x49) || // "II" little-endian
      (buffer[i] === 0x4d && buffer[i + 1] === 0x4d) // "MM" big-endian
    ) {
      // Check for TIFF magic number 0x002A
      if (buffer[i + 2] === 0x2a && buffer[i + 3] === 0x00) {
        return i;
      }
    }
  }
  // TIFF can also start with an "Exif\x00\x00" prefix (JPEG APP1 / Apple
  // item-data convention): the TIFF header follows the 6-byte prefix, so
  // return the position of the actual TIFF marker, not the prefix.
  for (let i = start; i + 10 <= end; i++) {
    if (
      buffer[i] === 0x45 && // E
      buffer[i + 1] === 0x78 && // x
      buffer[i + 2] === 0x69 && // i
      buffer[i + 3] === 0x66 && // f
      buffer[i + 4] === 0x00 &&
      buffer[i + 5] === 0x00 &&
      // the real TIFF byte-order marker must immediately follow
      ((buffer[i + 6] === 0x49 &&
        buffer[i + 7] === 0x49 &&
        buffer[i + 8] === 0x2a &&
        buffer[i + 9] === 0x00) ||
        (buffer[i + 6] === 0x4d &&
          buffer[i + 7] === 0x4d &&
          buffer[i + 8] === 0x00 &&
          buffer[i + 9] === 0x2a))
    ) {
      return i + 6;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Bounded-retry extraction (for controller use)
// ---------------------------------------------------------------------------

export type FetchMoreBytes = (
  start: number,
  end: number,
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
  fetchMore: FetchMoreBytes,
): Promise<Buffer | null> {
  // Detect container type from magic bytes.
  if (initialBuffer.length < 2) {
    return null;
  }

  const isJpeg = initialBuffer[0] === 0xff && initialBuffer[1] === 0xd8;
  const isPng =
    initialBuffer.length >= 8 &&
    initialBuffer.slice(0, 8).equals(PNG_SIGNATURE);
  const isHeifContainer = isAnyIsoBmff(initialBuffer);

  if (!isJpeg && !isPng && !isHeifContainer) {
    return null;
  }

  // Try extraction.
  let result: JpegExtractResult | PngExtractResult | HeifExtractResult;
  let videoResult: IsoBmffVideoExtractResult | null = null;

  if (isJpeg) {
    result = extractExifFromJpeg(initialBuffer);
  } else if (isPng) {
    result = extractExifFromPng(initialBuffer);
  } else {
    const heifResult = extractExifFromHeif(initialBuffer);
    if (heifResult.tiff) {
      return heifResult.tiff;
    }
    // Fall back to video path.
    videoResult = extractExifFromIsoBmffVideo(initialBuffer);
    if (videoResult.tiff) {
      return videoResult.tiff;
    }
    // If moov is missing entirely, signal truncation so the caller can
    // issue a tail read for non-faststart files.
    if (videoResult.moovMissing) {
      result = { tiff: null, truncated: true, bytesNeeded: MAX_EXIF_BYTES };
    } else {
      result = videoResult;
    }
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
  } else if (isPng) {
    result = extractExifFromPng(combined);
  } else {
    // ISO BMFF: retry both the HEIF photo path and the Apple video path.
    const heifCombined = extractExifFromHeif(combined);
    if (heifCombined.tiff) return heifCombined.tiff;
    const videoCombined = extractExifFromIsoBmffVideo(combined);
    return videoCombined.tiff;
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
  fetchMore: FetchMoreBytes,
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

/**
 * Scan a truncated tail buffer for a moov box header and attempt the Apple
 * uuid/Exif parse from there. Returns moovMissing=true when no plausible
 * moov header is found.
 */
function findMoovInTruncatedBuffer(
  buffer: Buffer,
  baseOffset: number,
): IsoBmffVideoExtractResult {
  const notFound: IsoBmffVideoExtractResult = {
    tiff: null,
    truncated: false,
    bytesNeeded: 0,
    moovMissing: true,
  };

  let idx = buffer.indexOf("moov", "latin1");
  while (idx !== -1) {
    const boxStart = idx - 4;
    if (boxStart >= 0) {
      const header = readBoxHeader(buffer, boxStart);
      // A real moov header: its payload must fit inside the buffer.
      if (header && header.type === "moov" && header.end <= buffer.length) {
        const result = extractFromMoov(buffer, header, baseOffset);
        if (result.tiff || result.truncated) {
          return { ...result, moovMissing: false };
        }
      }
    }
    idx = buffer.indexOf("moov", idx + 1, "latin1");
  }
  return notFound;
}
