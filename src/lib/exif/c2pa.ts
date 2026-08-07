/**
 * C2PA manifest detection – presence-only, no cryptographic verification.
 *
 * C2PA (Coalition for Content Provenance and Authenticity) embeds a
 * cryptographically-signed JUMBF manifest in:
 *
 *   - JPEG: APP11 (0xFFEB) segment containing JUMBF boxes with C2PA UUIDs
 *   - PNG:  "caBX" chunk containing C2PA JUMBF data
 *
 * This module only confirms the manifest container exists and extracts the
 * content-type label if present. It does NOT:
 *   - Parse full JUMBF / BMFF structures
 *   - Verify cryptographic signatures
 *   - Validate trust lists or certificate chains
 *   - Extract assertion content
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** JPEG APP11 marker byte (0xFFEB). */
const JPEG_APP11 = 0xffeb;

/** JUMBF "Content Type" UUID values mapped to human-readable labels. */
const C2PA_UUID_LABELS: Record<string, string> = {
  c2pa: "c2pa-manifest",
  "c2pa.assertions": "c2pa-assertions",
};

/** ASCII strings we scan for inside APP11 payloads. */
const C2PA_SCAN_STRINGS = Object.keys(C2PA_UUID_LABELS);

/** PNG chunk type for C2PA data. */
const C2PA_PNG_CHUNK = "caBX";

/** PNG 8-byte signature. */
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface C2paDetectionResult {
  detected: boolean;
  label: string | null;
}

// ---------------------------------------------------------------------------
// JPEG detection
// ---------------------------------------------------------------------------

/**
 * Scan a JPEG buffer for C2PA JUMBF data in APP11 segments.
 *
 * Walks JPEG markers and inspects each APP11 payload for C2PA-related UUIDs.
 * Returns on first match – does not accumulate multiple C2PA segments.
 *
 * Handles truncation gracefully: if a segment extends beyond the buffer,
 * returns `{ detected: false, label: null }` rather than throwing.
 */
export function detectC2paFromJpeg(buffer: Buffer): C2paDetectionResult {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8) {
    return { detected: false, label: null };
  }

  let offset = 2;

  while (offset + 1 < buffer.length) {
    const markerHi = buffer[offset];

    if (markerHi !== 0xff) {
      break;
    }

    const markerLo = buffer[offset + 1];

    // Stuffed byte (0xFF 0x00) or padding (0xFF 0xFF) – skip.
    if (markerLo === 0x00 || markerLo === 0xff) {
      offset += 1;
      continue;
    }

    const marker = markerHi * 256 + markerLo;

    // Stop at SOS – entropy-coded data follows, no length field.
    if (marker === 0xffda) {
      break;
    }

    // Stop at EOI.
    if (marker === 0xffd9) {
      break;
    }

    // All other markers have a 2-byte big-endian length field.
    offset += 2;
    if (offset + 2 > buffer.length) {
      // Truncated between marker and length field.
      return { detected: false, label: null };
    }

    const length = buffer.readUInt16BE(offset);
    if (length < 2) {
      break;
    }

    const segmentDataStart = offset + 2;
    const segmentEnd = offset + length;

    if (segmentEnd > buffer.length) {
      // Segment extends beyond buffer – cannot inspect safely.
      return { detected: false, label: null };
    }

    if (marker === JPEG_APP11) {
      const payload = buffer.slice(segmentDataStart, segmentEnd);

      for (const uuid of C2PA_SCAN_STRINGS) {
        if (payload.indexOf(uuid, 0, "ascii") !== -1) {
          const label = C2PA_UUID_LABELS[uuid];
          return { detected: true, label };
        }
      }
    }

    offset = segmentEnd;
  }

  return { detected: false, label: null };
}

// ---------------------------------------------------------------------------
// PNG detection
// ---------------------------------------------------------------------------

/**
 * Scan a PNG buffer for a C2PA `caBX` chunk.
 *
 * Walks PNG chunks. The `caBX` chunk contains C2PA JUMBF data. We confirm
 * its presence without parsing the JUMBF content.
 */
export function detectC2paFromPng(buffer: Buffer): C2paDetectionResult {
  if (buffer.length < 8 || !buffer.slice(0, 8).equals(PNG_SIGNATURE)) {
    return { detected: false, label: null };
  }

  let offset = 8;

  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString("ascii", offset + 4, offset + 8);

    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    const nextOffset = dataEnd + 4; // +4 for CRC

    if (chunkType === C2PA_PNG_CHUNK) {
      if (dataEnd <= buffer.length) {
        return { detected: true, label: "c2pa-manifest" };
      }
      // caBX chunk extends beyond buffer – truncated.
      return { detected: false, label: null };
    }

    if (chunkType === "IEND") {
      break;
    }

    // Guard against infinite loops from malformed data.
    if (nextOffset <= offset || chunkLength > 256 * 1024 * 1024) {
      break;
    }

    offset = nextOffset;
  }

  return { detected: false, label: null };
}

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

/**
 * Detect C2PA manifest presence in an image buffer.
 *
 * Delegates to the JPEG or PNG detector based on magic bytes.
 * Returns `{ detected: false, label: null }` for unrecognized formats.
 */
export function detectC2pa(buffer: Buffer): C2paDetectionResult {
  if (buffer.length < 2) {
    return { detected: false, label: null };
  }

  // JPEG: 0xFF 0xD8
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return detectC2paFromJpeg(buffer);
  }

  // PNG: 8-byte signature
  if (buffer.length >= 8 && buffer.slice(0, 8).equals(PNG_SIGNATURE)) {
    return detectC2paFromPng(buffer);
  }

  return { detected: false, label: null };
}
