/**
 * Detect the display rotation of an MP4/MOV video track from its tkhd box.
 *
 * Phone cameras (iPhone and Android alike) record landscape sensor pixels
 * and store a 90°/180°/270° rotation in the track header's display matrix.
 * MediaConvert ignores that matrix, so transcoded output comes out sideways
 * unless we compensate.
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

/**
 * Returns the video track's display dimensions (as stored in tkhd — these
 * already account for the rotation matrix), or null when they can't be
 * determined (no moov/trak, audio-only file, etc.).
 */
export function detectVideoDimensions(
  buf: Buffer,
): { width: number; height: number } | null {
  const found = walkForRotation(buf, 0, buf.length);
  if (!found || found.width === 0 || found.height === 0) return null;
  return { width: Math.round(found.width), height: Math.round(found.height) };
}

/**
 * Locate a child box by type within [start, end). Returns the offset of the
 * box body (past the 8- or 16-byte header) and the end of the box, or null.
 */
function findBox(
  buf: Buffer,
  start: number,
  end: number,
  type: string,
): { body: number; end: number } | null {
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const box = buf.toString("latin1", off + 4, off + 8);
    let hdr = 8;
    if (size === 1) {
      size = buf.readUInt32BE(off + 12); // low 32 bits of 64-bit size
      hdr = 16;
    } else if (size === 0) {
      size = end - off; // extends to end of enclosing box/file
    }
    if (size < 8) return null;
    if (box === type) return { body: off + hdr, end: off + size };
    off += size;
  }
  return null;
}

/**
 * Detect the total duration of an MP4/MOV file from its mvhd box
 * (moov → mvhd: timescale and duration). Returns seconds, or null when the
 * duration can't be parsed (no moov/mvhd, zero timescale, truncated file) —
 * callers should fall back to a duration-independent behavior.
 */
export function detectVideoDuration(buf: Buffer): number | null {
  // moov may sit anywhere in the file (phone recordings put it first; other
  // writers may put it after mdat), so scan top-level boxes for it.
  let off = 0;
  while (off + 8 <= buf.length) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    let hdr = 8;
    if (size === 1) {
      size = buf.readUInt32BE(off + 12);
      hdr = 16;
    } else if (size === 0) {
      size = buf.length - off;
    }
    if (size < 8) return null;

    if (type === "moov") {
      const mvhd = findBox(buf, off + hdr, off + size, "mvhd");
      if (mvhd) {
        const base = mvhd.body;
        const version = buf[base];
        // v0: ver/flags(4) creation(4) mod(4) timescale(4) duration(4)
        // v1: ver/flags(4) creation(8) mod(8) timescale(4) duration(8)
        const timescale =
          version === 1
            ? buf.readUInt32BE(base + 20)
            : buf.readUInt32BE(base + 12);
        // 64-bit durations: low 32 bits are plenty for video timelines
        const duration =
          version === 1
            ? buf.readUInt32BE(base + 28)
            : buf.readUInt32BE(base + 16);
        if (timescale > 0 && duration > 0) {
          const seconds = duration / timescale;
          if (Number.isFinite(seconds)) return seconds;
        }
        return null;
      }
    }
    off += size;
  }
  return null;
}
