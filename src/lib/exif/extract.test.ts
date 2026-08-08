/**
 * Tests for EXIF extraction from image and video containers.
 */

import { extractExif, stripExifBytes } from "./extract";

// ── Test helpers ──────────────────────────────────────────

/** Build a minimal JPEG with an APP1 Exif marker containing a simple TIFF. */
function buildJpegWithExif(): Buffer {
  // Minimal TIFF: "II" (LE) + magic 42 + offset-to-IFD(8) + 0 entries
  const tiff = Buffer.from([
    0x49,
    0x49, // "II"
    0x2a,
    0x00, // TIFF magic 42
    0x08,
    0x00,
    0x00,
    0x00, // offset to IFD (8)
    0x00,
    0x00, // IFD entry count = 0
  ]);

  const exifPayload = Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
  const app1Len = exifPayload.length + 2;
  const app1Header = Buffer.from([
    0xff,
    0xe1,
    (app1Len >> 8) & 0xff,
    app1Len & 0xff,
  ]);

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    app1Header,
    exifPayload,
    Buffer.from([0xff, 0xda, 0x00, 0x02, 0x00, 0x01, 0x00, 0x00]), // SOS
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

/** Build a minimal PNG with an eXIf chunk. */
function buildPngWithExif(): Buffer {
  const tiff = Buffer.from([
    0x49,
    0x49,
    0x2a,
    0x00,
    0x08,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);

  // eXIf chunk: len(4) + "eXIf"(4) + tiff_data + CRC(4)
  const chunkLen = tiff.length;
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32BE(chunkLen, 0);
  chunkHeader.write("eXIf", 4, 4, "ascii");

  // Dummy CRC (not validated by our code)
  const crc = Buffer.from([0x00, 0x00, 0x00, 0x00]);

  // IHDR chunk: 13 bytes data
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0); // width
  ihdrData.writeUInt32BE(1, 4); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // colour type (RGB)

  const ihdrHeader = Buffer.alloc(8);
  ihdrHeader.writeUInt32BE(13, 0);
  ihdrHeader.write("IHDR", 4, 4, "ascii");
  const ihdrCrc = Buffer.from([0x00, 0x00, 0x00, 0x00]);

  // IEND chunk
  const iendHeader = Buffer.alloc(8);
  iendHeader.write("IEND", 4, 4, "ascii");
  const iendCrc = Buffer.from([0x00, 0x00, 0x00, 0x00]);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
    ihdrHeader,
    ihdrData,
    ihdrCrc,
    chunkHeader,
    tiff,
    crc,
    iendHeader,
    iendCrc,
  ]);
}

/** Build a minimal ISO BMFF (MP4-style) container with an Exif uuid box. */
function buildIsoBmffWithExif(): Buffer {
  const tiff = Buffer.from([
    0x49,
    0x49,
    0x2a,
    0x00,
    0x08,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);

  // Exif payload inside uuid box: "Exif\0\0" + TIFF
  const exifPayload = Buffer.concat([Buffer.from("Exif\0\0"), tiff]);

  // Apple Exif uuid: 16 bytes (any value works — we match on payload magic)
  const uuid = Buffer.from("05C37E3C226F456BB1D65C3C3B3B3B3B", "hex");

  // uuid box header: size(4) + "uuid"(4) + uuid(16) + exifPayload
  const uuidBoxSize = 4 + 4 + 16 + exifPayload.length;
  const uuidHeader = Buffer.alloc(8);
  uuidHeader.writeUInt32BE(uuidBoxSize, 0);
  uuidHeader.write("uuid", 4, 4, "ascii");

  const uuidBox = Buffer.concat([uuidHeader, uuid, exifPayload]);

  // udta box: size(4) + "udta"(4) + uuidBox
  const udtaBoxSize = 4 + 4 + uuidBox.length;
  const udtaHeader = Buffer.alloc(8);
  udtaHeader.writeUInt32BE(udtaBoxSize, 0);
  udtaHeader.write("udta", 4, 4, "ascii");

  const udtaBox = Buffer.concat([udtaHeader, uuidBox]);

  // moov box: size(4) + "moov"(4) + udtaBox
  const moovBoxSize = 4 + 4 + udtaBox.length;
  const moovHeader = Buffer.alloc(8);
  moovHeader.writeUInt32BE(moovBoxSize, 0);
  moovHeader.write("moov", 4, 4, "ascii");

  const moovBox = Buffer.concat([moovHeader, udtaBox]);

  // ftyp box: mandatory first box in ISO BMFF
  const ftypSize = 24;
  const ftypHeader = Buffer.alloc(8);
  ftypHeader.writeUInt32BE(ftypSize, 0);
  ftypHeader.write("ftyp", 4, 4, "ascii");
  const ftypData = Buffer.alloc(ftypSize - 8, 0);

  const ftypBox = Buffer.concat([ftypHeader, ftypData]);

  return Buffer.concat([ftypBox, moovBox]);
}

// ── JPEG extraction ──────────────────────────────────────

describe("extractExif (JPEG)", () => {
  it("extracts EXIF from a JPEG with APP1 Exif marker", () => {
    const jpeg = buildJpegWithExif();
    const result = extractExif(jpeg);

    expect(result).not.toBeNull();
    // Result should be the TIFF data (starts with "II")
    expect(result![0]).toBe(0x49);
    expect(result![1]).toBe(0x49);
  });

  it("returns null for a JPEG without EXIF", () => {
    const noExif = Buffer.from([
      0xff,
      0xd8,
      0xff,
      0xda,
      0x00,
      0x02,
      0x00,
      0x01,
      0x00,
      0x00,
      0xff,
      0xd9,
    ]);
    expect(extractExif(noExif)).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(extractExif(Buffer.alloc(0))).toBeNull();
  });
});

// ── PNG extraction ───────────────────────────────────────

describe("extractExif (PNG)", () => {
  it("extracts EXIF from a PNG with eXIf chunk", () => {
    const png = buildPngWithExif();
    const result = extractExif(png);

    expect(result).not.toBeNull();
    expect(result![0]).toBe(0x49);
    expect(result![1]).toBe(0x49);
  });

  it("returns null for a bare PNG with no eXIf", () => {
    // Minimal valid PNG: sig + IHDR + IDAT + IEND (no eXIf)
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(1, 0);
    ihdrData.writeUInt32BE(1, 4);
    ihdrData[8] = 8;
    ihdrData[9] = 2;
    const ihdr = makeChunk("IHDR", ihdrData);

    const iend = makeChunk("IEND", Buffer.alloc(0));

    const png = Buffer.concat([sig, ihdr, iend]);
    expect(extractExif(png)).toBeNull();
  });
});

// ── ISO BMFF extraction ──────────────────────────────────

describe("extractExif (ISO BMFF / MP4)", () => {
  it("extracts EXIF from a ISO BMFF container with moov/udta/uuid(Exif)", () => {
    const mp4 = buildIsoBmffWithExif();
    const result = extractExif(mp4);

    expect(result).not.toBeNull();
    expect(result![0]).toBe(0x49);
    expect(result![1]).toBe(0x49);
  });

  it("returns null for an ISO BMFF container without Exif uuid box", () => {
    // ftyp + moov with no udta
    const ftypHeader = Buffer.alloc(8);
    ftypHeader.writeUInt32BE(24, 0);
    ftypHeader.write("ftyp", 4, 4, "ascii");
    const ftyp = Buffer.concat([ftypHeader, Buffer.alloc(16)]);

    const moovHeader = Buffer.alloc(8);
    moovHeader.writeUInt32BE(16, 0); // empty moov
    moovHeader.write("moov", 4, 4, "ascii");
    const moov = Buffer.concat([moovHeader, Buffer.alloc(8)]);

    const mp4 = Buffer.concat([ftyp, moov]);
    expect(extractExif(mp4)).toBeNull();
  });

  it("returns null for non-ISO-BMFF data", () => {
    const random = Buffer.alloc(100, 0xab);
    expect(extractExif(random)).toBeNull();
  });
});

// ── Raw TIFF fallback ────────────────────────────────────

describe("extractExif (Raw TIFF)", () => {
  it("extracts raw TIFF with little-endian header", () => {
    const tiff = Buffer.from([
      0x49,
      0x49,
      0x2a,
      0x00,
      0x08,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    const result = extractExif(tiff);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(tiff.length);
  });

  it("extracts raw TIFF with big-endian header", () => {
    const tiff = Buffer.from([
      0x4d,
      0x4d,
      0x00,
      0x2a,
      0x00,
      0x00,
      0x00,
      0x08,
      0x00,
      0x00,
    ]);
    const result = extractExif(tiff);
    expect(result).not.toBeNull();
  });
});

// ── EXIF stripping ───────────────────────────────────────

describe("stripExifBytes", () => {
  it("removes APP1 Exif marker from JPEG", () => {
    const jpeg = buildJpegWithExif();
    const stripped = stripExifBytes(jpeg);

    // Verify SOI is preserved
    expect(stripped[0]).toBe(0xff);
    expect(stripped[1]).toBe(0xd8);

    // The APP1 marker should be gone — next marker should be SOS or something else
    const exifSegment = extractExif(stripped);
    expect(exifSegment).toBeNull();
  });

  it("removes eXIf chunk from PNG", () => {
    const png = buildPngWithExif();
    const stripped = stripExifBytes(png);

    const exifSegment = extractExif(stripped);
    expect(exifSegment).toBeNull();
  });

  it("does not mutate the original buffer", () => {
    const jpeg = buildJpegWithExif();
    const copy = Buffer.from(jpeg);

    stripExifBytes(jpeg);

    // Original must be unchanged
    expect(jpeg.equals(copy)).toBe(true);
  });

  it("returns unchanged buffer for unknown format", () => {
    const random = Buffer.from("hello world");
    const stripped = stripExifBytes(random);
    expect(stripped.equals(random)).toBe(true);
  });
});

// ── Max scan boundary ────────────────────────────────────

describe("MAX_EXIF_SCAN boundary", () => {
  it("handles buffer smaller than MAX_EXIF_SCAN", () => {
    const tiny = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // just SOI + EOI
    const result = extractExif(tiny);
    expect(result).toBeNull();
  });
});

// ── Helper: make a PNG chunk ──────────────────────────────

function makeChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 4, "ascii");
  const crc = Buffer.from([0x00, 0x00, 0x00, 0x00]);
  return Buffer.concat([header, data, crc]);
}
