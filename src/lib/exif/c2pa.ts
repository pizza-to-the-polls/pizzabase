/**
 * C2PA manifest detection – presence-only, no cryptographic verification.
 */
const JPEG_APP11 = 0xffeb;
const C2PA_UUID_LABELS: Record<string, string> = {
  c2pa: "c2pa-manifest",
  "c2pa.assertions": "c2pa-assertions",
};
const C2PA_SCAN_STRINGS = Object.keys(C2PA_UUID_LABELS);
const C2PA_PNG_CHUNK = "caBX";
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface C2paDetectionResult {
  detected: boolean;
  label: string | null;
}

export function detectC2paFromJpeg(buffer: Buffer): C2paDetectionResult {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8) {
    return { detected: false, label: null };
  }
  let offset = 2;
  while (offset + 1 < buffer.length) {
    const markerHi = buffer[offset];
    if (markerHi !== 0xff) break;
    const markerLo = buffer[offset + 1];
    if (markerLo === 0x00 || markerLo === 0xff) { offset += 1; continue; }
    const marker = markerHi * 256 + markerLo;
    if (marker === 0xffda || marker === 0xffd9) break;
    offset += 2;
    if (offset + 2 > buffer.length) return { detected: false, label: null };
    const length = buffer.readUInt16BE(offset);
    if (length < 2) break;
    const segStart = offset + 2;
    const segEnd = offset + length;
    if (segEnd > buffer.length) return { detected: false, label: null };
    if (marker === JPEG_APP11) {
      const payload = buffer.slice(segStart, segEnd);
      for (const uuid of C2PA_SCAN_STRINGS) {
        if (payload.indexOf(uuid, 0, "ascii") !== -1) {
          return { detected: true, label: C2PA_UUID_LABELS[uuid] };
        }
      }
    }
    offset = segEnd;
  }
  return { detected: false, label: null };
}

export function detectC2paFromPng(buffer: Buffer): C2paDetectionResult {
  if (buffer.length < 8 || !buffer.slice(0, 8).equals(PNG_SIGNATURE)) {
    return { detected: false, label: null };
  }
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString("ascii", offset + 4, offset + 8);
    const dataEnd = offset + 8 + chunkLength;
    const nextOffset = dataEnd + 4;
    if (chunkType === C2PA_PNG_CHUNK) {
      return dataEnd <= buffer.length
        ? { detected: true, label: "c2pa-manifest" }
        : { detected: false, label: null };
    }
    if (chunkType === "IEND") break;
    if (nextOffset <= offset || chunkLength > 256 * 1024 * 1024) break;
    offset = nextOffset;
  }
  return { detected: false, label: null };
}

function detectC2paFromBuffer(buffer: Buffer): C2paDetectionResult {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return detectC2paFromJpeg(buffer);
  if (buffer.length >= 8 && buffer.slice(0, 8).equals(PNG_SIGNATURE)) return detectC2paFromPng(buffer);
  for (const uuid of C2PA_SCAN_STRINGS) {
    if (buffer.indexOf(uuid, 0, "ascii") !== -1) {
      return { detected: true, label: C2PA_UUID_LABELS[uuid] };
    }
  }
  return { detected: false, label: null };
}

export async function detectC2pa(
  buffer: Buffer,
  fetchSidecar?: () => Promise<Buffer | null>
): Promise<C2paDetectionResult> {
  if (buffer.length < 2) return { detected: false, label: null };
  let result = detectC2paFromBuffer(buffer);
  if (!result.detected && fetchSidecar) {
    try {
      const sidecar = await fetchSidecar();
      if (sidecar && sidecar.length >= 2) {
        result = detectC2paFromBuffer(sidecar);
      }
    } catch { /* non-fatal */ }
  }
  return result;
}
