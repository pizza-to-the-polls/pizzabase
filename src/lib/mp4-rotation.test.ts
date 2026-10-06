import { detectInputRotation, detectVideoDuration } from "./mp4-rotation";

/**
 * Build a minimal, spec-correct tkhd v0 box:
 *   ver/flags(4) creation(4) mod(4) trackID(4) reserved(4) duration(4)
 *   reserved(8) layer(2) altGroup(2) volume(2) reserved(2) matrix(36)
 *   width(4) height(4)   → body 84 bytes, box 92
 */
const IDENTITY = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
const ROT_90 = [0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824];
const ROT_180 = [-65536, 0, 0, 0, -65536, 0, 0, 0, 1073741824];
const ROT_270 = [0, -65536, 0, 65536, 0, 0, 0, 0, 1073741824];

function tkhdBox(matrix: number[], widthPx: number, heightPx: number): Buffer {
  const body = Buffer.alloc(84);
  // ver/flags already zero
  body.writeUInt32BE(1, 4); // creation
  body.writeUInt32BE(1, 8); // modification
  body.writeUInt32BE(1, 12); // track id
  // 16: reserved(4), 20: duration(4), 24: reserved(8)
  // 32: layer/alt/volume/reserved (8 bytes) — already zero
  matrix.forEach((v, i) => body.writeInt32BE(v, 40 + i * 4));
  body.writeUInt32BE(widthPx * 65536, 76);
  body.writeUInt32BE(heightPx * 65536, 80);

  return Buffer.concat([
    Buffer.from([0, 0, 0, body.length + 8]),
    Buffer.from("tkhd", "latin1"),
    body,
  ]);
}

function trakBox(tkhd: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 0, tkhd.length + 8]),
    Buffer.from("trak", "latin1"),
    tkhd,
  ]);
}

const ftyp = Buffer.from([
  0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 0, 0, 0, 0,
]);

function moovBox(children: Buffer[]): Buffer {
  const inner = Buffer.concat(children);
  return Buffer.concat([
    Buffer.from([0, 0, 0, inner.length + 8]),
    Buffer.from("moov", "latin1"),
    inner,
  ]);
}

describe("detectInputRotation", () => {
  it("detects 90° rotation (phone portrait)", () => {
    const buf = Buffer.concat([
      ftyp,
      moovBox([trakBox(tkhdBox(ROT_90, 480, 360))]),
    ]);
    expect(detectInputRotation(buf)).toBe("DEGREES_90");
  });

  it("detects 270° rotation", () => {
    const buf = Buffer.concat([
      ftyp,
      moovBox([trakBox(tkhdBox(ROT_270, 480, 360))]),
    ]);
    expect(detectInputRotation(buf)).toBe("DEGREES_270");
  });

  it("detects 180° rotation", () => {
    const buf = Buffer.concat([
      ftyp,
      moovBox([trakBox(tkhdBox(ROT_180, 480, 360))]),
    ]);
    expect(detectInputRotation(buf)).toBe("DEGREES_180");
  });

  it("returns null for identity (no rotation needed)", () => {
    const buf = Buffer.concat([
      ftyp,
      moovBox([trakBox(tkhdBox(IDENTITY, 480, 360))]),
    ]);
    expect(detectInputRotation(buf)).toBeNull();
  });

  it("returns null when the track has no dimensions (audio-only)", () => {
    const buf = Buffer.concat([
      ftyp,
      moovBox([trakBox(tkhdBox(IDENTITY, 0, 0))]),
    ]);
    expect(detectInputRotation(buf)).toBeNull();
  });

  it("skips audio tracks (0x0) and finds the video track in a later trak", () => {
    const buf = Buffer.concat([
      ftyp,
      moovBox([
        trakBox(tkhdBox(IDENTITY, 0, 0)), // audio — no dimensions
        trakBox(tkhdBox(ROT_90, 480, 360)), // video — portrait
      ]),
    ]);
    expect(detectInputRotation(buf)).toBe("DEGREES_90");
  });

  it("returns null for a buffer with no moov box", () => {
    const buf = Buffer.concat([ftyp, Buffer.alloc(64)]);
    expect(detectInputRotation(buf)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectVideoDuration
// ---------------------------------------------------------------------------

/**
 * Build a minimal mvhd box. v0 body:
 *   ver/flags(4) creation(4) mod(4) timescale(4) duration(4) ...
 * v1 body:
 *   ver/flags(4) creation(8) mod(8) timescale(4) duration(8) ...
 */
function mvhdBox(
  timescale: number,
  duration: number,
  version: 0 | 1 = 0,
): Buffer {
  const body = Buffer.alloc(version === 0 ? 100 : 104);
  body[0] = version;
  if (version === 0) {
    body.writeUInt32BE(timescale, 12);
    body.writeUInt32BE(duration, 16);
  } else {
    body.writeUInt32BE(Math.floor(duration / 2 ** 32), 24); // high word
    body.writeUInt32BE(duration % 2 ** 32, 28); // low word
    body.writeUInt32BE(timescale, 20);
  }
  return Buffer.concat([
    Buffer.from([0, 0, 0, body.length + 8]),
    Buffer.from("mvhd", "latin1"),
    body,
  ]);
}

function mdatBox(payload: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 0, payload.length + 8]),
    Buffer.from("mdat", "latin1"),
    payload,
  ]);
}

describe("detectVideoDuration", () => {
  it("computes seconds from an mvhd v0 box", () => {
    // 18000 ticks at 600/s = 30s
    const buf = Buffer.concat([
      ftyp,
      moovBox([mvhdBox(600, 18000), trakBox(tkhdBox(IDENTITY, 1920, 1080))]),
    ]);
    expect(detectVideoDuration(buf)).toBe(30);
  });

  it("computes seconds from an mvhd v1 (64-bit) box", () => {
    const buf = Buffer.concat([ftyp, moovBox([mvhdBox(600, 18000, 1)])]);
    expect(detectVideoDuration(buf)).toBe(30);
  });

  it("reads the low 32 bits of a 64-bit duration", () => {
    const buf = Buffer.concat([
      ftyp,
      moovBox([mvhdBox(600, 2 ** 32 + 12000, 1)]),
    ]);
    expect(detectVideoDuration(buf)).toBe(20);
  });

  it("finds moov placed after mdat", () => {
    const buf = Buffer.concat([
      ftyp,
      mdatBox(Buffer.alloc(64)),
      moovBox([mvhdBox(1000, 4500)]),
    ]);
    expect(detectVideoDuration(buf)).toBe(4.5);
  });

  it("returns null when there is no moov box", () => {
    const buf = Buffer.concat([ftyp, Buffer.alloc(64)]);
    expect(detectVideoDuration(buf)).toBeNull();
  });

  it("returns null when timescale is zero", () => {
    const buf = Buffer.concat([ftyp, moovBox([mvhdBox(0, 18000)])]);
    expect(detectVideoDuration(buf)).toBeNull();
  });

  it("returns null when duration is zero", () => {
    const buf = Buffer.concat([ftyp, moovBox([mvhdBox(600, 0)])]);
    expect(detectVideoDuration(buf)).toBeNull();
  });
});
