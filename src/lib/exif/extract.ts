/**
 * EXIF extraction from image and video files.
 *
 * Supported formats:
 *   - JPEG: APP1 marker (0xFFE1) containing "Exif\0\0" + TIFF data
 *   - PNG:  eXIf ancillary chunk
 *   - ISO BMFF (HEIC/HEIF/MP4/MOV): uuid box under moov/udta
 *     or moov/trak/mdia/minf/stbl/stsd with Exif data
 *
 * Only the first 64KB of the file is examined.  The caller must
 * supply a Buffer of at least that size for reliable extraction.
 */

/** Maximum bytes to scan from the start of a file. */
export const MAX_EXIF_SCAN = 65536; // 64 KB

/**
 * Extract the raw EXIF segment (TIFF bytes inside an Exif container)
 * from a media file buffer.  Returns a subarray of the input buffer
 * or null if no EXIF data is found.
 */
export function extractExif(buffer: Buffer): Buffer | null {
  if (buffer.length < 4) return null;

  // ── JPEG ──────────────────────────────────────────────
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return extractExifFromJpeg(buffer);
  }

  // ── PNG ───────────────────────────────────────────────
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return extractExifFromPng(buffer);
  }

  // ── ISO BMFF (HEIC/HEIF/MP4/MOV) ──────────────────────
  // ftyp box starts with 4-byte size + "ftyp"
  if (isIsoBmff(buffer)) {
    return extractExifFromIsoBmff(buffer);
  }

  // ── Raw TIFF (fallback) ───────────────────────────────
  // "II" (little-endian) or "MM" (big-endian) at offset 0
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x49) ||
    (buffer[0] === 0x4d && buffer[1] === 0x4d)
  ) {
    return buffer.subarray(0);
  }

  return null;
}

// ── EXIF stripping (byte-level surgery) ─────────────────

/**
 * Return a new Buffer with all EXIF metadata removed.  Does not
 * mutate the original buffer.  For JPEG the APP1 Exif marker is
 * excised, for PNG the eXIf chunk is removed, and for ISO BMFF
 * (HEIC/MP4/MOV) the "Exif\0\0" magic inside uuid boxes is zeroed.
 *
 * Unknown / unsupported formats are returned unchanged.
 */
export function stripExifBytes(buffer: Buffer): Buffer {
  if (buffer.length < 4) return buffer;

  // ── JPEG ──────────────────────────────────────────────
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return stripExifFromJpegBytes(buffer);
  }

  // ── PNG ───────────────────────────────────────────────
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return stripExifFromPngBytes(buffer);
  }

  // ── ISO BMFF (HEIC/HEIF/MP4/MOV) ──────────────────────
  if (isIsoBmff(buffer)) {
    return stripExifFromIsoBmffBytes(buffer);
  }

  // Unknown format — return as-is
  return buffer;
}

// ── JPEG stripping helpers ───────────────────────────────

/**
 * Remove the APP1 Exif marker from a JPEG buffer.
 * Returns the original buffer if no Exif marker is found.
 */
function stripExifFromJpegBytes(buffer: Buffer): Buffer {
  let offset = 2;
  const limit = Math.min(buffer.length, MAX_EXIF_SCAN);

  while (offset + 4 <= limit) {
    if (buffer[offset] !== 0xff) break;

    const markerType = buffer[offset + 1];
    if (markerType === 0xda) break; // SOS — no more markers

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
        // Exise the APP1 Exif marker: concat bytes before and after
        const markerStart = offset;
        const markerEnd = offset + 2 + segLen;
        return Buffer.concat([
          buffer.subarray(0, markerStart),
          buffer.subarray(markerEnd),
        ]);
      }
    }

    offset += 2 + segLen;
  }

  return buffer;
}

// ── PNG stripping helpers ────────────────────────────────

/**
 * Remove the eXIf ancillary chunk from a PNG buffer.
 * Returns the original buffer if no eXIf chunk is found.
 */
function stripExifFromPngBytes(buffer: Buffer): Buffer {
  let offset = 8;
  const limit = Math.min(buffer.length, MAX_EXIF_SCAN);

  while (offset + 12 <= limit) {
    const chunkLen = buffer.readUInt32BE(offset);
    const chunkType = buffer.subarray(offset + 4, offset + 8).toString("ascii");

    if (chunkType === "IEND") break;

    if (chunkType === "eXIf") {
      const chunkTotal = 12 + chunkLen; // 4(len)+4(type)+data+4(CRC)
      return Buffer.concat([
        buffer.subarray(0, offset),
        buffer.subarray(offset + chunkTotal),
      ]);
    }

    offset += 12 + chunkLen;
  }

  return buffer;
}

// ── ISO BMFF stripping helpers ───────────────────────────

/**
 * Zero-out the "Exif\0\0" magic inside uuid boxes under moov/udta.
 * This preserves the container structure but makes EXIF unreadable.
 */
function stripExifFromIsoBmffBytes(buffer: Buffer): Buffer {
  const result = Buffer.from(buffer); // copy
  const limit = Math.min(buffer.length, MAX_EXIF_SCAN);

  let offset = 0;
  while (offset + 8 <= limit) {
    const header = parseBoxHeader(result, offset);
    if (!header) break;

    if (header.boxType === "moov") {
      zeroExifInMoov(
        result,
        offset + header.headerSize,
        Math.min(buffer.length, offset + header.boxSize)
      );
    }

    offset += header.boxSize;
  }

  return result;
}

function zeroExifInMoov(buffer: Buffer, start: number, end: number): void {
  let offset = start;
  while (offset + 8 <= end) {
    const header = parseBoxHeader(buffer, offset);
    if (!header) break;

    if (header.boxType === "udta" || header.boxType === "meta") {
      zeroExifInChildren(
        buffer,
        offset + header.headerSize,
        Math.min(end, offset + header.boxSize)
      );
    }

    offset += header.boxSize;
  }
}

function zeroExifInChildren(buffer: Buffer, start: number, end: number): void {
  let offset = start;
  while (offset + 8 <= end) {
    const header = parseBoxHeader(buffer, offset);
    if (!header) break;

    if (header.boxType === "uuid") {
      const payloadStart = offset + 24; // 8 header + 16 uuid
      if (
        payloadStart + 6 <= end &&
        buffer[payloadStart] === 0x45 &&
        buffer[payloadStart + 1] === 0x78 &&
        buffer[payloadStart + 2] === 0x69 &&
        buffer[payloadStart + 3] === 0x66 &&
        buffer[payloadStart + 4] === 0x00 &&
        buffer[payloadStart + 5] === 0x00
      ) {
        // Zero out magic bytes — makes EXIF unreadable
        buffer[payloadStart] = 0x58; // X
        buffer[payloadStart + 1] = 0x78; // x
      }
    }

    offset += header.boxSize;
  }
}

// ── JPEG helpers ─────────────────────────────────────────

/**
 * Walk JPEG markers looking for APP1 (0xFFE1) with "Exif\0\0" signature.
 * Only searches within the first MAX_EXIF_SCAN bytes.
 */
function extractExifFromJpeg(buffer: Buffer): Buffer | null {
  let offset = 2; // skip SOI (0xFFD8)
  const limit = Math.min(buffer.length, MAX_EXIF_SCAN);

  while (offset + 4 <= limit) {
    if (buffer[offset] !== 0xff) {
      // Not a marker — corrupted or embedded thumbnail data
      break;
    }

    const markerType = buffer[offset + 1];

    // SOS (0xDA) — start of scan, no more markers follow
    if (markerType === 0xda) break;

    if (offset + 4 > buffer.length) break;

    // Segment length includes the 2 length bytes but not the 0xFF 0xXX marker
    const segLen = buffer.readUInt16BE(offset + 2);

    if (markerType === 0xe1) {
      // APP1 — check for "Exif\0\0" after the 4-byte header
      if (
        offset + 10 <= buffer.length &&
        buffer[offset + 4] === 0x45 && // E
        buffer[offset + 5] === 0x78 && // x
        buffer[offset + 6] === 0x69 && // i
        buffer[offset + 7] === 0x66 && // f
        buffer[offset + 8] === 0x00 &&
        buffer[offset + 9] === 0x00
      ) {
        // TIFF data starts 10 bytes into this APP1 marker
        return buffer.subarray(offset + 10);
      }
    }

    offset += 2 + segLen; // move to next marker
  }

  return null;
}

// ── PNG helpers ──────────────────────────────────────────

/**
 * Walk PNG chunks looking for the eXIf ancillary chunk.
 */
function extractExifFromPng(buffer: Buffer): Buffer | null {
  let offset = 8; // skip PNG signature
  const limit = Math.min(buffer.length, MAX_EXIF_SCAN);

  while (offset + 12 <= limit) {
    const chunkLen = buffer.readUInt32BE(offset);
    const chunkType = buffer.subarray(offset + 4, offset + 8).toString("ascii");

    if (chunkType === "IEND") break; // end-of-image chunk

    if (chunkType === "eXIf" && chunkLen > 0) {
      // Exif data starts immediately after the chunk type (no
      // null-padding like JPEG).  The TIFF header is right there.
      const exifStart = offset + 8;
      const exifEnd = exifStart + chunkLen;
      if (exifEnd <= buffer.length) {
        return buffer.subarray(exifStart, exifEnd);
      }
    }

    // 4 (length) + 4 (type) + chunkLen (data) + 4 (CRC) = 12 + chunkLen
    offset += 12 + chunkLen;
  }

  return null;
}

// ── ISO BMFF helpers ─────────────────────────────────────

/**
 * Fast check: does the buffer start with the ISO BMFF ftyp box?
 */
function isIsoBmff(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  // ftyp box: 4-byte size + "ftyp"
  return (
    buffer[4] === 0x66 && // f
    buffer[5] === 0x74 && // t
    buffer[6] === 0x79 && // y
    buffer[7] === 0x70 // p
  );
}

/**
 * Read a big-endian 32-bit unsigned integer at `offset`.
 */
function readU32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32BE(offset);
}

/**
 * Parse an ISO BMFF box header.  Returns [boxType: string, boxSize: number,
 * headerSize: number].  For uuid boxes, boxType is "uuid" + raw UUID bytes
 * to disambiguate.
 *
 * Boxes with size === 1 use the 8-byte "largesize" field that follows
 * the type field.
 */
function parseBoxHeader(
  buffer: Buffer,
  offset: number
): { boxType: string; boxSize: number; headerSize: number } | null {
  if (offset + 8 > buffer.length) return null;

  let size = readU32(buffer, offset);
  const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
  let headerSize = 8;

  if (size === 1) {
    // Extended 64-bit size
    if (offset + 16 > buffer.length) return null;
    const high = readU32(buffer, offset + 8);
    const low = readU32(buffer, offset + 12);
    // Only support sizes up to Number.MAX_SAFE_INTEGER
    size = high * 0x100000000 + low;
    if (!Number.isSafeInteger(size) || size < 16) return null;
    headerSize = 16;
  } else if (size === 0) {
    // Box extends to end of file — pretend it fills the buffer
    size = buffer.length - offset;
  }

  if (size < headerSize) return null;

  return { boxType: type, boxSize: size, headerSize };
}

/**
 * Navigate ISO BMFF box hierarchy to find EXIF data.
 *
 * The EXIF data in Apple HEVC/H.264 video and HEIC images is stored in a
 * "uuid" box whose user type bytes identify it as an Exif container.  This
 * uuid box typically lives under moov/udta/ (most common for video) or
 * moov/meta/ (some images).  Inside the uuid box, the payload starts with
 * "Exif\0\0" followed by the TIFF data — same as the JPEG APP1 payload.
 *
 * The EXIF uuid box's 16-byte user type is one of:
 *   - Apple Exif: 05C37E3C-226F-456B-B1D6-5C3C3B3B3B3B (seen in iOS media)
 *   - There may be other uuid boxes — we check for "Exif\0\0" after the
 *     uuid payload header.
 */
function extractExifFromIsoBmff(buffer: Buffer): Buffer | null {
  const limit = Math.min(buffer.length, MAX_EXIF_SCAN);

  // Walk top-level boxes looking for moov
  let offset = 0;
  while (offset + 8 <= limit) {
    const header = parseBoxHeader(buffer, offset);
    if (!header) break;

    if (header.boxType === "moov") {
      return searchMoovBox(buffer, offset + header.headerSize, header.boxSize);
    }

    offset += header.boxSize;
  }

  return null;
}

/**
 * Search inside the moov box for EXIF data under udta or meta.
 */
function searchMoovBox(
  buffer: Buffer,
  boxStart: number,
  boxSize: number
): Buffer | null {
  const boxEnd = Math.min(buffer.length, boxStart + boxSize);
  let offset = boxStart;

  while (offset + 8 <= boxEnd) {
    const header = parseBoxHeader(buffer, offset);
    if (!header) break;

    if (header.boxType === "udta" || header.boxType === "meta") {
      const childEnd = offset + header.boxSize;
      let childOffset = offset + header.headerSize;

      while (childOffset + 8 <= childEnd && childOffset < boxEnd) {
        const childHeader = parseBoxHeader(buffer, childOffset);
        if (!childHeader) break;

        // Check if this child is an Exif uuid box
        const maybeExif = tryExtractExifFromBox(
          buffer,
          childOffset,
          childHeader
        );
        if (maybeExif) return maybeExif;

        childOffset += childHeader.boxSize;
      }
    }

    offset += header.boxSize;
  }

  return null;
}

/**
 * If the box at `offset` is an Exif-bearing uuid box, return the TIFF data.
 * Otherwise return null.
 */
function tryExtractExifFromBox(
  buffer: Buffer,
  offset: number,
  header: { boxType: string; boxSize: number; headerSize: number }
): Buffer | null {
  // ISO BMFF Exif data lives inside uuid boxes whose payload starts
  // with "Exif\0\0" (same prefix as JPEG APP1).  The uuid box header
  // is: 4-byte size + "uuid" + 16-byte user type + payload.
  //
  // "uuid" boxes have 8-byte standard header + 16-byte user type = 24
  // byte header total.
  if (header.boxType !== "uuid") return null;
  // Need: 8 (header) + 16 (user type) + at least 8 for payload
  if (header.boxSize < 32) return null;

  const payloadStart = offset + 24; // skip size(4)+type(4)+uuid(16)
  const payloadAvailable = offset + header.boxSize - payloadStart;

  if (payloadAvailable < 6) return null;

  // Check for "Exif\0\0" magic
  if (
    buffer[payloadStart] === 0x45 &&
    buffer[payloadStart + 1] === 0x78 &&
    buffer[payloadStart + 2] === 0x69 &&
    buffer[payloadStart + 3] === 0x66 &&
    buffer[payloadStart + 4] === 0x00 &&
    buffer[payloadStart + 5] === 0x00
  ) {
    // Return TIFF data after the "Exif\0\0" header
    return buffer.subarray(payloadStart + 6, offset + header.boxSize);
  }

  return null;
}
