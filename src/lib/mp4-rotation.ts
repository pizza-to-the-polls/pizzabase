/**
 * Detect the display rotation of an MP4/MOV video track from its tkhd box.
 *
 * Phone cameras record landscape sensor pixels and store a 90°/180°/270°
 * rotation in the track header's display matrix. MediaConvert ignores that
 * matrix, so transcoded output comes out sideways unless we compensate.
 *
 * Usage: pass the raw file bytes; the returned value maps directly onto
 * MediaConvert's Input.VideoSelector.Rotate (omit when null — identity).
 */

export type InputRotation = "DEGREES_90" | "DEGREES_180" | "DEGREES_270";

const CONTAINER_BOXES = new Set(["moov", "trak", "mdia", "minf", "stbl"]);

function boxType(buf: Buffer, off: number): string {
  return buf.toString("latin1", off + 4, off + 8);
}

function walkForRotation(
  buf: Buffer,
  start: number,
  end: number,
): {
  rotation: InputRotation | null;
  width: number;
  height: number;
} | null {
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = boxType(buf, off);
    let hdr = 8;
    if (size === 1) {
      // 64-bit size — read low 32 bits (layers are never that large)
      size = buf.readUInt32BE(off + 12);
      hdr = 16;
    } else if (size === 0) {
      size = end - off; // extends to end of enclosing box/file
    }
    if (size < 8) return null;

    if (type === "tkhd") {
      const base = off + hdr;
      const version = buf[base];
      // matrix: 9 × int32 (a,b,u,c,d,v,tx,ty,w) — 16.16 fixed point for a,b,c,d
      const matrixOff = base + (version === 0 ? 40 : 48);
      const [a, b, , c, d] = [
        buf.readInt32BE(matrixOff),
        buf.readInt32BE(matrixOff + 4),
        0,
        buf.readInt32BE(matrixOff + 12),
        buf.readInt32BE(matrixOff + 16),
      ];
      const wOff = matrixOff + 36;
      const width = buf.readUInt32BE(wOff) / 65536;
      const height = buf.readUInt32BE(wOff + 4) / 65536;

      // The video track is the one with pixel dimensions; audio/metadata
      // tracks carry 0x0. Only report rotation for it.
      if (width === 0 || height === 0) return null;

      let rotation: InputRotation | null = null;
      if (b === 65536 && c === -65536) rotation = "DEGREES_90";
      else if (a === -65536 && d === -65536) rotation = "DEGREES_180";
      else if (b === -65536 && c === 65536) rotation = "DEGREES_270";
      return { rotation, width, height };
    }

    if (CONTAINER_BOXES.has(type)) {
      const found = walkForRotation(buf, off + hdr, off + size);
      if (found) return found;
    }
    off += size;
  }
  return null;
}

/**
 * Returns the MediaConvert Rotate value that compensates for the input's
 * display-matrix rotation, or null when the pixels are already display-
 * oriented (identity matrix) — MediaConvert's default behavior is correct.
 */
export function detectInputRotation(buf: Buffer): InputRotation | null {
  return walkForRotation(buf, 0, buf.length)?.rotation ?? null;
}
