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

  // HEIF/HEIC/MP4/MOV detection: ISO BMFF container with ftyp box.
  if (isAnyIsoBmff(buffer)) {
    return extractExifFromHeif(buffer).tiff;
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
// HEIF / HEIC extraction (ISO Base Media File Format / BMFF)
// ---------------------------------------------------------------------------

// HEIF files start with an ftyp box containing a brand like "heic", "mif1",
// "heix", "heim", "heis", "hevc", "avif", etc.
// Video containers (MP4, MOV) use the same ISO BMFF container format with
// different ftyp brands.
const HEIF_BRANDS = ["heic", "mif1", "heix", "heim", "heis", "hevc", "avif"];
const VIDEO_BMFF_BRANDS = ["mp42", "mp41", "isom", "qt  ", "MSNV", "avc1"];
const ALL_ISO_BMFF_BRANDS = [...HEIF_BRANDS, ...VIDEO_BMFF_BRANDS];

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
export function isIsoBmff(
  buffer: Buffer,
  brands: string[]
): boolean {
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
 * Walk the direct children of a parent box, calling visitor for each child
 * of the given type. Stops when visitor returns non-null.
 */
function findChildBox<T>(
  buffer: Buffer,
  parentStart: number,
  parentEnd: number,
  boxType: string,
  visitor: (header: BoxHeader) => T | null
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

  // ---- 1. Locate meta box ----
  // Skip past ftyp: read its header to find where it ends.
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

  // ---- 2. Parse iloc (Item Location Box) ----
  // The meta box is a full box (4 bytes version+flags), so children
  // start at dataStart + 4, not dataStart.
  const metaChildrenStart = metaHeader.dataStart + 4;
  const metaChildrenEnd = metaHeader.end;
  interface IlocEntry {
    itemId: number;
    offset: number;
    length: number;
  }

  let ilocEntries: IlocEntry[] | null = null;

  findChildBox(
    buffer,
    metaChildrenStart,
    metaChildrenEnd,
    HEIF_ILOC_BOX,
    (h) => {
      // iloc is a full box (4-byte version/flags after header).
      let off = h.dataStart;
      if (off + 4 > h.end) return null;
      const version = buffer[off];
      // const flags = buffer.readUIntBE(off + 1, 3);
      off += 4;

      // version 0/1/2 differ in field widths.
      // tslint:disable-next-line:no-bitwise
      const offsetSize = (buffer[off] >> 4) & 0x0f;
      // tslint:disable-next-line:no-bitwise
      const lengthSize = buffer[off] & 0x0f;
      // tslint:disable-next-line:no-bitwise
      const baseOffsetSize = (buffer[off + 1] >> 4) & 0x0f;
      off += 2;

      let itemCount: number;
      if (version < 2) {
        if (off + 2 > h.end) return null;
        itemCount = buffer.readUInt16BE(off);
        off += 2;
      } else {
        if (off + 4 > h.end) return null;
        itemCount = buffer.readUInt32BE(off);
        off += 4;
      }

      const entries: IlocEntry[] = [];
      for (let i = 0; i < itemCount; i++) {
        let itemId: number;
        if (version < 2) {
          if (off + 2 > h.end) return null;
          itemId = buffer.readUInt16BE(off);
          off += 2;
        } else {
          if (off + 4 > h.end) return null;
          itemId = buffer.readUInt32BE(off);
          off += 4;
        }

        // construction method: version 1+ has 2 bits reserved, then
        // construction_method in low 4 bits of a 2-byte field.
        let constructionMethod = 0;
        if (version >= 1) {
          if (off + 2 > h.end) return null;
          // tslint:disable-next-line:no-bitwise
          constructionMethod = buffer.readUInt16BE(off) & 0x000f;
          off += 2;
        }

        if (off + 2 > h.end) return null;
        buffer.readUInt16BE(off); // dataReferenceIndex
        off += 2;

        let baseOffset = 0;
        if (baseOffsetSize > 0) {
          if (off + baseOffsetSize > h.end) return null;
          baseOffset = buffer.readUIntBE(off, baseOffsetSize);
          off += baseOffsetSize;
        }

        let extentCount: number;
        if (off + 2 > h.end) return null;
        extentCount = buffer.readUInt16BE(off);
        off += 2;

        let extentOffset = 0;
        let extentLength = 0;

        for (let e = 0; e < extentCount; e++) {
          if (
            (offsetSize > 0 && off + offsetSize > h.end) ||
            (lengthSize > 0 && off + offsetSize + lengthSize > h.end)
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

      ilocEntries = entries;
      return entries; // signal found
    }
  );

  if (!ilocEntries || ilocEntries.length === 0) {
    return { tiff: null, truncated: false, bytesNeeded: 0 };
  }

  // ---- 3. Parse iinf (Item Information Box) to find Exif item ID ----
  let exifItemId: number | null = null;

  findChildBox(
    buffer,
    metaChildrenStart,
    metaChildrenEnd,
    HEIF_IINF_BOX,
    (h) => {
      // iinf is a full box.
      let off = h.dataStart;
      if (off + 4 > h.end) return null;
      const version = buffer[off];
      off += 4;

      let entryCount: number;
      if (version === 0) {
        if (off + 2 > h.end) return null;
        entryCount = buffer.readUInt16BE(off);
        off += 2;
      } else {
        if (off + 4 > h.end) return null;
        entryCount = buffer.readUInt32BE(off);
        off += 4;
      }

      const iinfEnd = h.end;

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
        infeOff += 4;

        // item_name: null-terminated string (if any space remains) — skipped.

        if (itemType === "Exif" || itemType === "exif") {
          exifItemId = itemId;
          return itemId; // signal found
        }

        // Move to next infe.
        off = infeHeader.end;
      }

      return null;
    }
  );

  if (exifItemId === null) {
    return { tiff: null, truncated: false, bytesNeeded: 0 };
  }

  // ---- 4. Look up the offset in iloc entries ----
  const entry = ilocEntries.find((e) => e.itemId === exifItemId);
  if (!entry) {
    return { tiff: null, truncated: false, bytesNeeded: 0 };
  }

  // ---- 5. Check truncation ----
  const payloadEnd = entry.offset + entry.length;
  if (payloadEnd > buffer.length) {
    return {
      tiff: null,
      truncated: true,
      bytesNeeded: payloadEnd,
    };
  }

  // ---- 6. Extract TIFF payload ----
  const dataStart = entry.offset;

  // The Exif item often starts with a 4-byte zero prefix + "Exif" + 1 zero byte
  // (6 bytes total), but this is embedded in mdat and the exact format varies.
  // We check for common TIFF byte-order markers (II or MM) and strip any
  // Exif header prefix.
  if (
    dataStart + 6 <= payloadEnd &&
    buffer.toString("ascii", dataStart, dataStart + 6) ===
      "\x00\x00\x00\x00Exif"
  ) {
    // Skip the 6-byte prefix: 4 zero bytes + "Exif" (but we already have the 'f'
    // from the "Exif" string — wait, that's 4 zeros + 'E' 'x' 'i' 'f' = 8 bytes.
    // Actually the string is: 4 null bytes, then "Exif". That's 8 bytes.
    // Let me re-check: "\x00\x00\x00\x00Exif" is 8 chars = 8 bytes.
  }

  // More reliably: look for TIFF byte order marker.
  // HEIF stores EXIF as: [4 zero bytes]["Exif"][4 more bytes padding varies]
  // then TIFF starts with "II" or "MM".
  const tiffStart = findTiffStart(buffer, dataStart, payloadEnd);
  if (tiffStart === -1) {
    // No TIFF marker found — return the data as-is for exif-reader to try.
    return {
      tiff: buffer.slice(dataStart, payloadEnd),
      truncated: false,
      bytesNeeded: 0,
    };
  }

  return {
    tiff: buffer.slice(tiffStart, payloadEnd),
    truncated: false,
    bytesNeeded: 0,
  };
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
  // TIFF can also start with "Exif\x00\x00" prefix.
  for (let i = start; i + 6 <= end; i++) {
    if (
      buffer[i] === 0x45 && // E
      buffer[i + 1] === 0x78 && // x
      buffer[i + 2] === 0x69 && // i
      buffer[i + 3] === 0x66 && // f
      buffer[i + 4] === 0x00 &&
      buffer[i + 5] === 0x00
    ) {
      return i;
    }
  }
  return -1;
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
  const isHeifContainer = isAnyIsoBmff(initialBuffer);

  if (!isJpeg && !isPng && !isHeifContainer) {
    return null;
  }

  // Try extraction.
  let result: JpegExtractResult | PngExtractResult | HeifExtractResult;
  if (isJpeg) {
    result = extractExifFromJpeg(initialBuffer);
  } else if (isPng) {
    result = extractExifFromPng(initialBuffer);
  } else {
    result = extractExifFromHeif(initialBuffer);
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
    result = extractExifFromHeif(combined);
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
