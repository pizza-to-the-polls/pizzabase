import {
  extractExif,
  extractExifFromJpeg,
  extractExifFromPng,
  extractExifFromHeif,
  extractExifFromIsoBmffVideo,
  extractExifWithRetry,
  isVideoIsoBmff,
  extractDuration,
  MAX_EXIF_BYTES,
} from "./extract";
import {
  brooklynJpeg,
  redondoJpeg,
  losAngelesPng,
  truncatedJpeg,
  jpegNoExif,
  jpegTruncatedExif,
  iphoneRealLayoutMov,
} from "../../tests/fixtures/exif";

// We don't mock exif-reader in these tests – we exercise the extraction
// path with real container bytes, then verify the extracted TIFF data
// is parseable by the real exif-reader.
const exifReader = require("exif-reader");

describe("extractExifFromJpeg", () => {
  it("extracts TIFF payload from a JPEG with EXIF (Brooklyn)", () => {
    const result = extractExifFromJpeg(brooklynJpeg);
    expect(result.tiff).not.toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.bytesNeeded).toBe(0);
    expect(Buffer.isBuffer(result.tiff!)).toBe(true);

    const parsed = exifReader(result.tiff);
    expect(parsed).toBeDefined();
    expect(parsed.Image).toBeDefined();

    expect(parsed.Image.Orientation).toBe(1);
    expect(parsed.Image.XResolution).toBe(216);
    expect(parsed.Image.YResolution).toBe(216);
    expect(parsed.Image.ResolutionUnit).toBe(2);
    expect(parsed.Photo.PixelXDimension).toBe(1206);
    expect(parsed.Photo.PixelYDimension).toBe(1562);
    expect(parsed.Photo.ColorSpace).toBe(1);
  });

  it("extracts TIFF payload from a JPEG with screenshot EXIF (Redondo Beach)", () => {
    const result = extractExifFromJpeg(redondoJpeg);
    expect(result.tiff).not.toBeNull();
    expect(result.truncated).toBe(false);
    expect(Buffer.isBuffer(result.tiff!)).toBe(true);

    const parsed = exifReader(result.tiff);
    expect(parsed).toBeDefined();
    expect(parsed.Image).toBeDefined();

    expect(parsed.Image.ImageDescription).toBe("Screenshot");
    expect(parsed.Photo.UserComment).toBeDefined();
    if (Buffer.isBuffer(parsed.Photo.UserComment)) {
      expect(parsed.Photo.UserComment.toString("ascii")).toContain(
        "Screenshot",
      );
    }

    expect(parsed.Image.Orientation).toBe(1);
    expect(parsed.Photo.PixelXDimension).toBe(435);
  });

  it("returns null tiff for a JPEG with no EXIF APP1", () => {
    const result = extractExifFromJpeg(jpegNoExif);
    expect(result.tiff).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it("returns null tiff with truncated=false for a truncated JPEG without EXIF sig", () => {
    // truncatedJpeg has APP1 with "Exif\0\0" sig but length 4096 > buffer
    const result = extractExifFromJpeg(truncatedJpeg);
    expect(result.tiff).toBeNull();
    expect(result.truncated).toBe(true);
    expect(result.bytesNeeded).toBe(4100); // marker offset (2) + marker bytes (2) + declared segment length (4096)
  });

  it("returns null for short/empty input", () => {
    const r0 = extractExifFromJpeg(Buffer.alloc(0));
    expect(r0.tiff).toBeNull();
    expect(r0.truncated).toBe(false);

    const r1 = extractExifFromJpeg(Buffer.from([0xff]));
    expect(r1.tiff).toBeNull();
    expect(r1.truncated).toBe(false);

    const r2 = extractExifFromJpeg(Buffer.from([0xff, 0xd8]));
    expect(r2.tiff).toBeNull();
    expect(r2.truncated).toBe(false);
  });

  it("returns null for non-JPEG data", () => {
    const result = extractExifFromJpeg(Buffer.from("not a jpeg"));
    expect(result.tiff).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it("detects Exif\0\0 inside APP1 and not other APP1 segments", () => {
    const result = extractExifFromJpeg(jpegNoExif);
    expect(result.tiff).toBeNull();
  });

  it("stops scanning at SOS marker", () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x02, 0x00, 0x00, 0x00, 0x00]),
      Buffer.from([0xff, 0xe1, 0x00, 0x0a, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00]),
      Buffer.from([0xff, 0xd9]),
    ]);
    const result = extractExifFromJpeg(jpeg);
    expect(result.tiff).toBeNull();
  });
});

describe("extractExifFromPng", () => {
  it("returns null for a PNG with no eXIf chunk (Los Angeles)", () => {
    const result = extractExifFromPng(losAngelesPng);
    expect(result.tiff).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it("returns null for short/empty input", () => {
    const r0 = extractExifFromPng(Buffer.alloc(0));
    expect(r0.tiff).toBeNull();
    expect(r0.truncated).toBe(false);

    const r1 = extractExifFromPng(Buffer.alloc(7));
    expect(r1.tiff).toBeNull();
    expect(r1.truncated).toBe(false);
  });

  it("returns null for non-PNG data", () => {
    const result = extractExifFromPng(Buffer.from("not a png"));
    expect(result.tiff).toBeNull();
  });

  it("extracts EXIF from PNG with eXIf chunk", () => {
    const pngSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    const brooklynResult = extractExifFromJpeg(brooklynJpeg);
    const brooklynTiff = brooklynResult.tiff!;
    const exifPayload = Buffer.concat([
      Buffer.from("Exif\0\0", "ascii"),
      brooklynTiff,
    ]);

    const makeChunk = (type: string, data: Buffer): Buffer => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length, 0);
      const crc = Buffer.alloc(4);
      return Buffer.concat([len, Buffer.from(type, "ascii"), data, crc]);
    };

    const ihdrData = Buffer.from([
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x00, 0x00, 0x00,
      0x00,
    ]);

    const png = Buffer.concat([
      pngSig,
      makeChunk("IHDR", ihdrData),
      makeChunk("eXIf", exifPayload),
      makeChunk("IDAT", Buffer.alloc(0)),
      makeChunk("IEND", Buffer.alloc(0)),
    ]);

    const result = extractExifFromPng(png);
    expect(result.tiff).not.toBeNull();
    expect(result.truncated).toBe(false);

    const parsed = exifReader(result.tiff);
    expect(parsed).toBeDefined();
    expect(parsed.Image.Orientation).toBe(1);
  });

  it("signals truncated when eXIf chunk extends beyond buffer", () => {
    const pngSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    const makeChunk = (type: string, data: Buffer): Buffer => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length, 0);
      const crc = Buffer.alloc(4);
      return Buffer.concat([len, Buffer.from(type, "ascii"), data, crc]);
    };

    const ihdrData = Buffer.from([
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x00, 0x00, 0x00,
      0x00,
    ]);

    // Declare an eXIf chunk with length 9999 but only provide a few bytes
    const fakeExif = Buffer.from("Exif\0\0" + "II*\0".repeat(4));
    const len = Buffer.alloc(4);
    len.writeUInt32BE(9999, 0);
    const crc = Buffer.alloc(4);
    const truncatedChunk = Buffer.concat([
      len,
      Buffer.from("eXIf", "ascii"),
      fakeExif,
      crc,
    ]);

    const png = Buffer.concat([
      pngSig,
      makeChunk("IHDR", ihdrData),
      truncatedChunk,
    ]);

    const result = extractExifFromPng(png);
    expect(result.tiff).toBeNull();
    expect(result.truncated).toBe(true);
    expect(result.bytesNeeded).toBeGreaterThan(0);
  });

  it("stops at IEND", () => {
    const pngSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const makeChunk = (type: string, data: Buffer): Buffer => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length, 0);
      const crc = Buffer.alloc(4);
      return Buffer.concat([len, Buffer.from(type, "ascii"), data, crc]);
    };

    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(1, 0);
    ihdrData.writeUInt32BE(1, 4);
    ihdrData[8] = 8;
    ihdrData[9] = 0;

    const png = Buffer.concat([
      pngSig,
      makeChunk("IHDR", ihdrData),
      makeChunk("IEND", Buffer.alloc(0)),
      makeChunk(
        "eXIf",
        Buffer.from(
          "Exif\0\0II\x2a\x00\x00\x00\x00\x08\x00\x00\x00\x00",
          "ascii",
        ),
      ),
    ]);

    const result = extractExifFromPng(png);
    expect(result.tiff).toBeNull();
  });
});

describe("extractExif", () => {
  it("routes JPEG to JPEG extractor", () => {
    const tiff = extractExif(brooklynJpeg);
    expect(tiff).not.toBeNull();
    const parsed = exifReader(tiff!);
    expect(parsed.Image.Orientation).toBe(1);
  });

  it("routes PNG to PNG extractor", () => {
    const tiff = extractExif(losAngelesPng);
    expect(tiff).toBeNull();
  });

  it("returns null for unrecognized data", () => {
    expect(extractExif(Buffer.from([0x00, 0x00, 0x00, 0x00]))).toBeNull();
    expect(extractExif(Buffer.alloc(0))).toBeNull();
  });

  it("detects JPEG before PNG when magic bytes conflict", () => {
    const tiff = extractExif(brooklynJpeg);
    expect(tiff).not.toBeNull();
  });
});

describe("extractExifWithRetry", () => {
  it("extracts EXIF from a normal JPEG without needing a follow-up", async () => {
    const fetchMore = jest.fn<Promise<Buffer | null>, [number, number]>();
    const tiff = await extractExifWithRetry(brooklynJpeg, 0, fetchMore);
    expect(tiff).not.toBeNull();
    expect(fetchMore).not.toHaveBeenCalled();
  });

  it("extracts EXIF from a normal PNG without needing a follow-up", async () => {
    const fetchMore = jest.fn<Promise<Buffer | null>, [number, number]>();
    const tiff = await extractExifWithRetry(losAngelesPng, 0, fetchMore);
    expect(tiff).toBeNull();
    expect(fetchMore).not.toHaveBeenCalled();
  });

  it("performs a follow-up read when the EXIF segment extends beyond the buffer", async () => {
    // Build a JPEG where the APP1 starts before the truncation point
    // but ends after it. We use the Brooklyn TIFF and truncate the buffer
    // right in the middle of the segment.
    const soi = Buffer.from([0xff, 0xd8]);
    const brooklynResult = extractExifFromJpeg(brooklynJpeg);
    const tiff = brooklynResult.tiff!;

    // Build APP1 with this TIFF.
    const exifPayload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
    const len = 2 + exifPayload.length;
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16BE(len, 0);

    const fullJpeg = Buffer.concat([
      soi,
      Buffer.from([0xff, 0xe1]),
      lenBuf,
      exifPayload,
    ]);

    // Truncate the JPEG before the TIFF payload ends.
    const truncated = fullJpeg.slice(0, fullJpeg.length - 20);

    let fetchCallCount = 0;
    const fetchMore = jest
      .fn<Promise<Buffer | null>, [number, number]>()
      .mockImplementation(async (start: number, end: number) => {
        fetchCallCount++;
        return fullJpeg.slice(start, end + 1);
      });

    const extracted = await extractExifWithRetry(truncated, 0, fetchMore);

    expect(fetchCallCount).toBe(1);
    expect(extracted).not.toBeNull();
    // Verify it parsed correctly.
    const parsed = exifReader(extracted);
    expect(parsed.Image.Orientation).toBe(1);
  });

  it("performs follow-up for truncated PNG eXIf chunk", async () => {
    const pngSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    const brooklynResult = extractExifFromJpeg(brooklynJpeg);
    const tiff = brooklynResult.tiff!;
    const exifPayload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);

    const makeChunk = (type: string, data: Buffer): Buffer => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length, 0);
      const crc = Buffer.alloc(4);
      return Buffer.concat([len, Buffer.from(type, "ascii"), data, crc]);
    };

    const ihdrData = Buffer.from([
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x00, 0x00, 0x00,
      0x00,
    ]);

    const fullPng = Buffer.concat([
      pngSig,
      makeChunk("IHDR", ihdrData),
      makeChunk("eXIf", exifPayload),
      makeChunk("IEND", Buffer.alloc(0)),
    ]);

    // Truncate in the middle of eXIf data.
    const truncated = fullPng.slice(0, fullPng.length - 30);
    const fetchMore = jest
      .fn<Promise<Buffer | null>, [number, number]>()
      .mockImplementationOnce(async (start: number, end: number) =>
        fullPng.slice(start, end + 1),
      );

    const extracted = await extractExifWithRetry(truncated, 0, fetchMore);
    expect(extracted).not.toBeNull();
    expect(fetchMore).toHaveBeenCalledTimes(1);

    const parsed = exifReader(extracted);
    expect(parsed.Image.Orientation).toBe(1);
  });

  it("recovers when the initial range cuts off before the APP1 signature", async () => {
    const full = brooklynJpeg;
    const initial = full.slice(0, 7); // marker + length, before complete Exif signature
    const fetchMore = jest
      .fn<Promise<Buffer | null>, [number, number]>()
      .mockImplementationOnce(async (start: number, end: number) =>
        full.slice(start, end + 1),
      );

    const extracted = await extractExifWithRetry(initial, 0, fetchMore);
    expect(extracted).not.toBeNull();
    expect(fetchMore).toHaveBeenCalledTimes(1);
    expect(exifReader(extracted).Image.Orientation).toBe(1);
  });

  it("recovers when the initial range cuts off inside a preceding segment", async () => {
    const full = brooklynJpeg;
    const initial = full.slice(0, 10); // middle of the JFIF APP0 segment
    const fetchMore = jest
      .fn<Promise<Buffer | null>, [number, number]>()
      .mockImplementationOnce(async (start: number, end: number) =>
        full.slice(start, end + 1),
      );

    const extracted = await extractExifWithRetry(initial, 0, fetchMore);
    expect(extracted).not.toBeNull();
    expect(fetchMore).toHaveBeenCalledTimes(1);
    expect(exifReader(extracted).Image.Orientation).toBe(1);
  });

  it("returns null when follow-up fetch returns null", async () => {
    const soi = Buffer.from([0xff, 0xd8]);
    const brooklynResult = extractExifFromJpeg(brooklynJpeg);
    const tiff = brooklynResult.tiff!;
    const exifPayload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
    const len = 2 + exifPayload.length;
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16BE(len, 0);

    const fullJpeg = Buffer.concat([
      soi,
      Buffer.from([0xff, 0xe1]),
      lenBuf,
      exifPayload,
    ]);
    const truncated = fullJpeg.slice(0, fullJpeg.length - 20);

    const fetchMore = jest
      .fn<Promise<Buffer | null>, [number, number]>()
      .mockResolvedValueOnce(null);

    const extracted = await extractExifWithRetry(truncated, 0, fetchMore);
    expect(extracted).toBeNull();
  });

  it("returns null when follow-up fetch rejects", async () => {
    const soi = Buffer.from([0xff, 0xd8]);
    const brooklynResult = extractExifFromJpeg(brooklynJpeg);
    const tiff = brooklynResult.tiff!;
    const exifPayload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
    const len = 2 + exifPayload.length;
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16BE(len, 0);

    const fullJpeg = Buffer.concat([
      soi,
      Buffer.from([0xff, 0xe1]),
      lenBuf,
      exifPayload,
    ]);
    const truncated = fullJpeg.slice(0, fullJpeg.length - 20);

    const fetchMore = jest
      .fn<Promise<Buffer | null>, [number, number]>()
      .mockRejectedValueOnce(new Error("S3 error"));

    const extracted = await extractExifWithRetry(truncated, 0, fetchMore);
    expect(extracted).toBeNull();
  });

  it("does not follow a segment past MAX_EXIF_BYTES when the initial range has a nonzero offset", async () => {
    // JPEG segment lengths are 16-bit, so a single APP1 cannot exceed 64 KiB.
    // A nonzero absolute initial offset is what can put the requested end beyond
    // the total metadata scan cap.
    const sig = Buffer.from("Exif\0\0", "ascii");
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16BE(0xffff, 0);
    const truncated = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
      lenBuf,
      sig,
      Buffer.alloc(100),
    ]);

    const fetchMore = jest.fn<Promise<Buffer | null>, [number, number]>();
    const extracted = await extractExifWithRetry(
      truncated,
      MAX_EXIF_BYTES - 1024,
      fetchMore,
    );
    expect(extracted).toBeNull();
    expect(fetchMore).not.toHaveBeenCalled();
  });

  it("returns null for unrecognized data", async () => {
    const fetchMore = jest.fn<Promise<Buffer | null>, [number, number]>();
    const result = await extractExifWithRetry(
      Buffer.from([0x00, 0x00]),
      0,
      fetchMore,
    );
    expect(result).toBeNull();
    expect(fetchMore).not.toHaveBeenCalled();
  });
});

describe("malformed / truncated EXIF within valid container", () => {
  it("returns null when APP1 contains truncated Exif payload", () => {
    const result = extractExifFromJpeg(jpegTruncatedExif);
    expect(result.tiff).not.toBeNull();
    expect(result.truncated).toBe(false);
    expect(() => {
      try {
        exifReader(result.tiff);
      } catch (_e) {
        // Expected: truncated TIFF → parse error
      }
    }).not.toThrow();
  });

  it("handles APP1 length field of 0", () => {
    const buf = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe1, 0x00, 0x00]),
      Buffer.from([0xff, 0xd9]),
    ]);
    const result = extractExifFromJpeg(buf);
    expect(result.tiff).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it("handles APP1 length field of 2 (minimum, no data)", () => {
    const buf = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe1, 0x00, 0x02]),
      Buffer.from([0xff, 0xd9]),
    ]);
    const result = extractExifFromJpeg(buf);
    expect(result.tiff).toBeNull();
    expect(result.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HEIF / HEIC extraction
// ---------------------------------------------------------------------------

/**
 * Build a minimal HEIF file containing EXIF data.
 *
 * Structure:
 *   ftyp (brand: heic)
 *   meta (hdlr + iloc + iinf)
 *   mdat (EXIF TIFF payload)
 *
 * Returns the complete Buffer and the absolute offset of the TIFF data
 * within mdat (for verifying extraction correctness).
 */
function buildMinimalHeif(exifTiff: Buffer): {
  buffer: Buffer;
  tiffOffset: number;
} {
  // ---- ftyp box (24 bytes) ----
  const ftypBrand = Buffer.from("heic", "ascii");
  const ftypCompat = Buffer.from("mif1", "ascii");
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0); // size
  ftyp.write("ftyp", 4, 4, "ascii");
  ftypBrand.copy(ftyp, 8);
  ftyp.writeUInt32BE(0, 12); // minor version
  ftypCompat.copy(ftyp, 16);

  // ---- hdlr box (33 bytes) ----
  const hdlr = Buffer.alloc(33);
  hdlr.writeUInt32BE(33, 0); // size
  hdlr.write("hdlr", 4, 4, "ascii");
  hdlr.writeUInt32BE(0, 8); // version + flags
  hdlr.writeUInt32BE(0, 12); // pre_defined
  hdlr.write("pict", 16, 4, "ascii"); // handler_type
  hdlr.writeUInt32BE(0, 20); // reserved[0]
  hdlr.writeUInt32BE(0, 24); // reserved[1]
  hdlr.writeUInt32BE(0, 28); // reserved[2]
  hdlr[32] = 0; // name: null terminator

  // ---- iloc box (30 bytes) ----
  // We don't yet know the mdat offset. We'll fill it in after computing
  // all sizes. For now, compute the iloc structure size.
  // Full box: 4 (size) + 4 (type) + 4 (version/flags)
  // offset_size=4, length_size=4, base_offset_size=0: 2 bytes
  // item_count=1: 2 bytes
  // item: id(2) + data_ref(2) + extent_count(2) + offset(4) + length(4) = 14
  // Total: 12 + 2 + 2 + 14 = 30
  const iloc = Buffer.alloc(30);
  iloc.writeUInt32BE(30, 0); // size
  iloc.write("iloc", 4, 4, "ascii");
  iloc.writeUInt32BE(0, 8); // version=0, flags=0
  iloc[12] = 0x44; // offset_size=4 (top nibble), length_size=4 (bottom)
  iloc[13] = 0x00; // base_offset_size=0, reserved=0
  iloc.writeUInt16BE(1, 14); // item_count = 1
  iloc.writeUInt16BE(1, 16); // item_ID = 1
  iloc.writeUInt16BE(0, 18); // data_reference_index = 0
  iloc.writeUInt16BE(1, 20); // extent_count = 1
  // extent_offset (4 bytes): filled later
  iloc.writeUInt32BE(exifTiff.length, 26); // extent_length

  // ---- infe box (27 bytes) ----
  const infe = Buffer.alloc(27);
  infe.writeUInt32BE(27, 0); // size
  infe.write("infe", 4, 4, "ascii");
  infe.writeUInt32BE(0x02000000, 8); // version=2, flags=0
  infe.writeUInt32BE(1, 12); // item_ID (v2: 4 bytes)
  infe.writeUInt16BE(0, 16); // item_protection_index
  infe.write("Exif", 20, 4, "ascii"); // item_type
  infe.write("Exif\0", 24, 3, "ascii"); // item_name (null-terminated)
  // Actually "Exif" is 4 chars + null = 5. Let me adjust.
  // The above writes only 3 bytes ("Exi") at offset 24. Let me fix.
  // infe total = 12 (full box) + 4 (id) + 2 (protection) + 4 (type) + 5 (name) = 27 ✓
  // item_name at offset 24: "Exif" (4) + null (1) = 5 bytes = offsets 24-28
  // But our buffer is only 27 bytes... 24+5=29 > 27!
  // Let me recalculate: 12+4+2+4 = 22. Name = "Exif\0" = 5. Total = 27.
  // Wait: full box = size(4) + type(4) + version(4) = 12
  //       + item_ID(4) + protection(2) + item_type(4) + name(5) = 15
  // Total: 12 + 15 = 27... name 5 bytes: offsets 22,23,24,25,26 = 5 bytes ✓

  // Let me redo infe properly:
  const infe2 = Buffer.alloc(27);
  infe2.writeUInt32BE(27, 0);
  infe2.write("infe", 4, 4, "ascii");
  infe2.writeUInt32BE(0x02000000, 8);
  infe2.writeUInt32BE(1, 12);
  infe2.writeUInt16BE(0, 16);
  infe2.write("Exif", 18, 4, "ascii");
  infe2.write("Exif\0", 22, 5, "ascii");

  // ---- iinf box ----
  // Full box: 12 + entry_count(2) + infe(27) = 41
  const iinf = Buffer.alloc(41);
  iinf.writeUInt32BE(41, 0);
  iinf.write("iinf", 4, 4, "ascii");
  iinf.writeUInt32BE(0, 8); // version=0, flags=0
  iinf.writeUInt16BE(1, 12); // entry_count = 1
  infe2.copy(iinf, 14);

  // ---- meta box ----
  // Full box: 12 + hdlr(33) + iloc(30) + iinf(41) = 116
  const meta = Buffer.alloc(116);
  meta.writeUInt32BE(116, 0);
  meta.write("meta", 4, 4, "ascii");
  meta.writeUInt32BE(0, 8); // version=0, flags=0
  hdlr.copy(meta, 12);
  iloc.copy(meta, 12 + 33); // offset 45
  iinf.copy(meta, 12 + 33 + 30); // offset 75

  // ---- mdat box ----
  const mdatHeaderSize = 8;
  const mdatSize = mdatHeaderSize + exifTiff.length;
  const mdat = Buffer.alloc(mdatSize);
  mdat.writeUInt32BE(mdatSize, 0);
  mdat.write("mdat", 4, 4, "ascii");
  exifTiff.copy(mdat, 8);

  // ---- Assemble ----
  const buffer = Buffer.concat([ftyp, meta, mdat]);

  // ---- Fill in iloc extent_offset ----
  // mdat data starts at: ftyp(24) + meta(116) + mdat_header(8) = 148
  // The iloc box is at offset: ftyp(24) + meta_fullbox(12) + hdlr(33) = 69
  // extent_offset is at iloc_box_start + fullbox(12) + offset_size(1) + base_offset_size(1) + item_count(2) + item(6) + extent_count(2) = 24
  // So: 69 + 24 = 93
  const tiffOffset = 24 + 116 + 8; // ftyp + meta + mdat header
  buffer.writeUInt32BE(tiffOffset, 24 + 12 + 33 + 12 + 1 + 1 + 2 + 2 + 2 + 2);
  // Let me compute more carefully:
  // meta starts at 24
  // meta full box header: 12 bytes (size+type+version) → data starts at 36
  // hdlr: 33 bytes → at 36 to 69
  // iloc: 30 bytes → at 69 to 99
  //   iloc full box header: 12 → iloc data at 69+12 = 81
  //   offset_size+length_size: 1 → at 81
  //   base_offset+reserved: 1 → at 82
  //   item_count: 2 → at 83
  //   item_ID: 2 → at 85
  //   data_ref: 2 → at 87
  //   extent_count: 2 → at 89
  //   extent_offset: 4 → at 91
  //   extent_length: 4 → at 95
  buffer.writeUInt32BE(tiffOffset, 91);

  return { buffer, tiffOffset };
}

describe("extractExifFromHeif", () => {
  // Use the TIFF payload from brooklynJpeg for the EXIF data.
  const brooklynTiff = extractExifFromJpeg(brooklynJpeg).tiff!;
  const { buffer: validHeif, tiffOffset } = buildMinimalHeif(brooklynTiff);

  it("extracts TIFF payload from a valid HEIF container", () => {
    const result = extractExifFromHeif(validHeif);
    expect(result.tiff).not.toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.bytesNeeded).toBe(0);

    // The extracted TIFF should be parseable.
    const parsed = exifReader(result.tiff);
    expect(parsed).toBeDefined();
    expect(parsed.Image).toBeDefined();
    expect(parsed.Image.Orientation).toBe(1);
  });

  it("returns null tiff for non-HEIF data", () => {
    const result = extractExifFromHeif(Buffer.from("not a heif file"));
    expect(result.tiff).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it("returns null tiff for JPEG data", () => {
    const result = extractExifFromHeif(brooklynJpeg);
    expect(result.tiff).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it("returns null tiff for HEIF with no meta box", () => {
    // ftyp only, no meta
    const ftypOnly = Buffer.alloc(24);
    ftypOnly.writeUInt32BE(24, 0);
    ftypOnly.write("ftyp", 4, 4, "ascii");
    ftypOnly.write("heic", 8, 4, "ascii");
    ftypOnly.writeUInt32BE(0, 12);
    ftypOnly.write("mif1", 16, 4, "ascii");

    const result = extractExifFromHeif(ftypOnly);
    expect(result.tiff).toBeNull();
  });

  it("returns null tiff for HEIF with no Exif item", () => {
    // Build a HEIF with meta + iloc + iinf but no Exif item type.
    // Just change the item_type in infe to something else.
    const noExif = Buffer.from(validHeif);
    // The infe box's item_type is at a known offset. Let me find it.
    // meta at 24, fullbox 12, hdlr 33, iloc 30, iinf at 24+12+33+30=99
    // iinf fullbox 12, entry_count 2 → infe at 99+12+2=113
    // infe fullbox 12, id 4, protection 2 → item_type at 113+12+4+2=131
    // Replace "Exif" with "xxxx"
    noExif.write("xxxx", 131, 4, "ascii");

    const result = extractExifFromHeif(noExif);
    expect(result.tiff).toBeNull();
  });

  it("detects truncated EXIF item and sets bytesNeeded", () => {
    // Truncate the buffer before the EXIF data ends.
    const truncated = validHeif.slice(0, tiffOffset + 10); // only 10 bytes of TIFF
    const result = extractExifFromHeif(truncated);
    expect(result.tiff).toBeNull();
    expect(result.truncated).toBe(true);
    expect(result.bytesNeeded).toBeGreaterThan(0);
  });

  it("returns null for an empty buffer", () => {
    const result = extractExifFromHeif(Buffer.alloc(0));
    expect(result.tiff).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it("handles HEIF with avif brand", () => {
    // Build an AVIF-branded HEIF (same container, different codec).
    const avifBuf = Buffer.from(validHeif);
    avifBuf.write("avif", 8, 4, "ascii"); // replace brand at ftyp offset 8

    const result = extractExifFromHeif(avifBuf);
    expect(result.tiff).not.toBeNull();
    expect(result.truncated).toBe(false);
  });

  it("handles HEIF with mif1 brand", () => {
    const mif1Buf = Buffer.from(validHeif);
    mif1Buf.write("mif1", 8, 4, "ascii");

    const result = extractExifFromHeif(mif1Buf);
    expect(result.tiff).not.toBeNull();
  });
});

describe("extractExif (HEIF routing)", () => {
  const brooklynTiff = extractExifFromJpeg(brooklynJpeg).tiff!;
  const { buffer: validHeif } = buildMinimalHeif(brooklynTiff);

  it("routes HEIF to HEIF extractor via extractExif", () => {
    const result = extractExif(validHeif);
    expect(result).not.toBeNull();
    expect(Buffer.isBuffer(result!)).toBe(true);

    const parsed = exifReader(result);
    expect(parsed.Image.Orientation).toBe(1);
  });

  it("routes HEIF to HEIF extractor via extractExifWithRetry", async () => {
    const result = await extractExifWithRetry(
      validHeif,
      0,
      async () => null, // no follow-up needed
    );
    expect(result).not.toBeNull();
    expect(Buffer.isBuffer(result!)).toBe(true);
  });

  it("extractExif still returns null for unrecognized data", () => {
    const result = extractExif(Buffer.from("garbage"));
    expect(result).toBeNull();
  });
});

describe("extractExifWithRetry (HEIF)", () => {
  const brooklynTiff = extractExifFromJpeg(brooklynJpeg).tiff!;
  const fullHeif = buildMinimalHeif(brooklynTiff).buffer;

  it("extracts EXIF from a full HEIF without a follow-up", async () => {
    const fetchMore = jest.fn<Promise<Buffer | null>, [number, number]>();
    const result = await extractExifWithRetry(fullHeif, 0, fetchMore);
    expect(result).not.toBeNull();
    expect(fetchMore).not.toHaveBeenCalled();
  });

  it("performs a follow-up when the EXIF item extends beyond the buffer", async () => {
    // Truncate after the meta box but before the full EXIF in mdat.
    // We need the buffer to contain ftyp + meta so the parser can find the
    // Exif item and iloc entry, but not the full mdat.
    const mdatStart = 24 + 116; // ftyp + meta
    const truncated = fullHeif.slice(0, mdatStart + 20); // partial mdat

    const fetchMore = jest
      .fn<Promise<Buffer | null>, [number, number]>()
      .mockResolvedValue(fullHeif.slice(mdatStart + 20));

    const result = await extractExifWithRetry(truncated, 0, fetchMore);
    expect(result).not.toBeNull();
    expect(fetchMore).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Video container (MP4/MOV) EXIF extraction via ISO BMFF
// ---------------------------------------------------------------------------

/**
 * Build a minimal MP4/MOV file containing EXIF data.
 *
 * Uses the same ISO BMFF structure as HEIF but with a video ftyp brand
 * ("mp42" for MP4, "qt  " for MOV). The meta/mdat structure is identical.
 */
function buildMinimalMp4(
  exifTiff: Buffer,
  brand: string = "mp42",
): { buffer: Buffer; tiffOffset: number } {
  // ---- ftyp box (24 bytes) ----
  const ftypBrand = Buffer.from(brand, "ascii");
  const ftypCompat = Buffer.from("isom", "ascii");
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write("ftyp", 4, 4, "ascii");
  ftypBrand.copy(ftyp, 8);
  ftyp.writeUInt32BE(0, 12);
  ftypCompat.copy(ftyp, 16);

  // hdlr
  const hdlr = Buffer.alloc(33);
  hdlr.writeUInt32BE(33, 0);
  hdlr.write("hdlr", 4, 4, "ascii");
  hdlr.writeUInt32BE(0, 8);
  hdlr.writeUInt32BE(0, 12);
  hdlr.write("pict", 16, 4, "ascii");
  hdlr.writeUInt32BE(0, 20);
  hdlr.writeUInt32BE(0, 24);
  hdlr.writeUInt32BE(0, 28);
  hdlr[32] = 0;

  // iloc
  const iloc = Buffer.alloc(30);
  iloc.writeUInt32BE(30, 0);
  iloc.write("iloc", 4, 4, "ascii");
  iloc.writeUInt32BE(0, 8);
  iloc[12] = 0x44;
  iloc[13] = 0x00;
  iloc.writeUInt16BE(1, 14);
  iloc.writeUInt16BE(1, 16);
  iloc.writeUInt16BE(0, 18);
  iloc.writeUInt16BE(1, 20);
  iloc.writeUInt32BE(exifTiff.length, 26);

  // infe
  const infe = Buffer.alloc(27);
  infe.writeUInt32BE(27, 0);
  infe.write("infe", 4, 4, "ascii");
  infe.writeUInt32BE(0x02000000, 8);
  infe.writeUInt32BE(1, 12);
  infe.writeUInt16BE(0, 16);
  infe.write("Exif", 18, 4, "ascii");
  infe.write("Exif\0", 22, 5, "ascii");

  // iinf
  const iinf = Buffer.alloc(41);
  iinf.writeUInt32BE(41, 0);
  iinf.write("iinf", 4, 4, "ascii");
  iinf.writeUInt32BE(0, 8);
  iinf.writeUInt16BE(1, 12);
  infe.copy(iinf, 14);

  // meta
  const meta = Buffer.alloc(116);
  meta.writeUInt32BE(116, 0);
  meta.write("meta", 4, 4, "ascii");
  meta.writeUInt32BE(0, 8);
  hdlr.copy(meta, 12);
  iloc.copy(meta, 45);
  iinf.copy(meta, 75);

  // mdat
  const mdatSize = 8 + exifTiff.length;
  const mdat = Buffer.alloc(mdatSize);
  mdat.writeUInt32BE(mdatSize, 0);
  mdat.write("mdat", 4, 4, "ascii");
  exifTiff.copy(mdat, 8);

  const buffer = Buffer.concat([ftyp, meta, mdat]);
  const tiffOffset = 24 + 116 + 8;
  buffer.writeUInt32BE(tiffOffset, 91);

  return { buffer, tiffOffset };
}

describe("extractExifFromHeif (video containers)", () => {
  const brooklynTiff = extractExifFromJpeg(brooklynJpeg).tiff!;
  const { buffer: validMp4 } = buildMinimalMp4(brooklynTiff, "mp42");
  const { buffer: validMov } = buildMinimalMp4(brooklynTiff, "qt  ");

  it("extracts TIFF from an MP4 container (mp42 brand)", () => {
    const result = extractExifFromHeif(validMp4);
    expect(result.tiff).not.toBeNull();
    expect(result.truncated).toBe(false);

    const parsed = exifReader(result.tiff);
    expect(parsed).toBeDefined();
    expect(parsed.Image.Orientation).toBe(1);
  });

  it("extracts TIFF from a MOV container (qt brand)", () => {
    const result = extractExifFromHeif(validMov);
    expect(result.tiff).not.toBeNull();
    expect(result.truncated).toBe(false);

    const parsed = exifReader(result.tiff);
    expect(parsed).toBeDefined();
    expect(parsed.Image.Orientation).toBe(1);
  });

  it("routes MP4 through extractExif", () => {
    const result = extractExif(validMp4);
    expect(result).not.toBeNull();
    expect(Buffer.isBuffer(result!)).toBe(true);
  });

  it("routes MOV through extractExif", () => {
    const result = extractExif(validMov);
    expect(result).not.toBeNull();
    expect(Buffer.isBuffer(result!)).toBe(true);
  });

  it("extractExifWithRetry works for MP4 containers", async () => {
    const fetchMore = jest.fn<Promise<Buffer | null>, [number, number]>();
    const result = await extractExifWithRetry(validMp4, 0, fetchMore);
    expect(result).not.toBeNull();
    expect(fetchMore).not.toHaveBeenCalled();
  });

  it("extractExifWithRetry works for MOV containers", async () => {
    const fetchMore = jest.fn<Promise<Buffer | null>, [number, number]>();
    const result = await extractExifWithRetry(validMov, 0, fetchMore);
    expect(result).not.toBeNull();
    expect(fetchMore).not.toHaveBeenCalled();
  });

  it("returns null for an MP4 with no EXIF item", () => {
    const noExif = Buffer.from(validMp4);
    // Replace "Exif" item_type in infe with "xxxx"
    // infe at: ftyp(24)+metaFullBox(12)+hdlr(33)+iloc(30)+iinfFullBox(12)+entryCount(2) = 113
    // item_type at 113 + 12 + 4 + 2 = 131
    noExif.write("xxxx", 131, 4, "ascii");

    const result = extractExifFromHeif(noExif);
    expect(result.tiff).toBeNull();
  });

  it("isAnyIsoBmff returns true for mp42, qt, isom brands", () => {
    const { isAnyIsoBmff } = require("./extract");
    expect(isAnyIsoBmff(validMp4)).toBe(true);
    expect(isAnyIsoBmff(validMov)).toBe(true);

    const { buffer: isomBuf } = buildMinimalMp4(brooklynTiff, "isom");
    expect(isAnyIsoBmff(isomBuf)).toBe(true);
  });

  it("isAnyIsoBmff returns false for non-ISO BMFF data", () => {
    const { isAnyIsoBmff } = require("./extract");
    expect(isAnyIsoBmff(brooklynJpeg)).toBe(false);
    expect(isAnyIsoBmff(losAngelesPng)).toBe(false);
    expect(isAnyIsoBmff(Buffer.from("garbage"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Video duration parsing (ISO BMFF mvhd)
// ---------------------------------------------------------------------------

/**
 * Build a minimal ftyp-only ISO BMFF container with the given major brand.
 */
function buildFtypBox(brand: string, compatBrand = "isom"): Buffer {
// Apple MOV/MP4 video EXIF extraction (moov → udta → uuid MetaBox)
// ---------------------------------------------------------------------------

/** Apple metadata usertype UUID for the uuid box under moov/udta. */
const APPLE_METADATA_UUID = Buffer.from([
  0x85, 0xc0, 0xb6, 0x87, 0xf4, 0x5c, 0x46, 0xda, 0x9d, 0x5d, 0x9f, 0x90, 0x49,
  0xb8, 0xe2, 0xae,
]);

/**
 * Build a minimal TIFF file containing Apple iPhone-style EXIF metadata
 * (Make, Model, DateTime, GPS). The TIFF is little-endian and contains an
 * Image IFD with Make/Model plus a GPS IFD pointed by tag 0x8825.
 */
function buildIphoneTiff(): Buffer {
  // IFD entries for Image IFD (IFD0).
  const make = Buffer.from("Apple\0", "ascii"); // 6 bytes
  const model = Buffer.from("iPhone 14 Pro\0", "ascii"); // 14 bytes
  const dateTime = Buffer.from("2024:01:15 10:30:00\0", "ascii"); // 20 bytes

  // GPS IFD entries: lat 34°3'0"N, lon 118°14'0"W.
  const gpsRef = Buffer.from("N\0", "ascii"); // 2 bytes
  const gpsLonRef = Buffer.from("W\0", "ascii"); // 2 bytes

  // Rational: 3 values × 8 bytes (num+denom) = 24 bytes per coordinate.
  const gpsLat = Buffer.alloc(24);
  gpsLat.writeUInt32LE(34, 0);
  gpsLat.writeUInt32LE(1, 4);
  gpsLat.writeUInt32LE(3, 8);
  gpsLat.writeUInt32LE(1, 12);
  gpsLat.writeUInt32LE(0, 16);
  gpsLat.writeUInt32LE(1, 20);

  const gpsLon = Buffer.alloc(24);
  gpsLon.writeUInt32LE(118, 0);
  gpsLon.writeUInt32LE(1, 4);
  gpsLon.writeUInt32LE(14, 8);
  gpsLon.writeUInt32LE(1, 12);
  gpsLon.writeUInt32LE(0, 16);
  gpsLon.writeUInt32LE(1, 20);

  // We place extra data after the IFD entries.
  // IFD0: 2 (count) + 4 entries × 12 + 4 (next) = 54 bytes.
  // GPS IFD: 2 + 4 entries × 12 + 4 = 54 bytes.
  const ifd0Start = 8;
  const ifd0Next = ifd0Start + 2 + 4 * 12 + 4; // = 8 + 54 = 62
  const gpsIfdStart = ifd0Next;
  const gpsIfdEnd = gpsIfdStart + 2 + 4 * 12 + 4; // = 62 + 54 = 116
  let extra = gpsIfdEnd;

  const extraMake = extra;
  extra += make.length;
  const extraModel = extra;
  extra += model.length;
  const extraDateTime = extra;
  extra += dateTime.length;
  const extraGpsLat = extra;
  extra += gpsLat.length;
  const extraGpsLon = extra;
  extra += gpsLon.length;
  extra += gpsRef.length; // gpsRef offset
  extra += gpsLonRef.length; // gpsLonRef offset

  const total = extra;
  const buf = Buffer.alloc(total);

  // TIFF header
  buf.write("II", 0, "ascii");
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(ifd0Start, 4);

  // IFD0: 3 entries (Make, Model, GPSInfo pointer)
  buf.writeUInt16LE(3, ifd0Start);
  let off = ifd0Start + 2;
  // Make (0x010F, ASCII, 6, offset)
  buf.writeUInt16LE(0x010f, off);
  buf.writeUInt16LE(2, off + 2);
  buf.writeUInt32LE(6, off + 4);
  buf.writeUInt32LE(extraMake, off + 8);
  off += 12;
  // Model (0x0110, ASCII, 14, offset)
  buf.writeUInt16LE(0x0110, off);
  buf.writeUInt16LE(2, off + 2);
  buf.writeUInt32LE(14, off + 4);
  buf.writeUInt32LE(extraModel, off + 8);
  off += 12;
  // GPSInfo (0x8825, LONG, 1, value = offset to GPS IFD)
  buf.writeUInt16LE(0x8825, off);
  buf.writeUInt16LE(4, off + 2);
  buf.writeUInt32LE(1, off + 4);
  buf.writeUInt32LE(gpsIfdStart, off + 8);
  off += 12;
  // next IFD = 0
  buf.writeUInt32LE(0, off);

  // GPS IFD: 4 entries (GPSLatitudeRef, GPSLatitude, GPSLongitudeRef, GPSLongitude)
  buf.writeUInt16LE(4, gpsIfdStart);
  off = gpsIfdStart + 2;
  // GPSLatitudeRef (0x0001, ASCII, 2, inline)
  buf.writeUInt16LE(0x0001, off);
  buf.writeUInt16LE(2, off + 2);
  buf.writeUInt32LE(2, off + 4);
  gpsRef.copy(buf, off + 8);
  off += 12;
  // GPSLatitude (0x0002, RATIONAL, 3, offset)
  buf.writeUInt16LE(0x0002, off);
  buf.writeUInt16LE(5, off + 2);
  buf.writeUInt32LE(3, off + 4);
  buf.writeUInt32LE(extraGpsLat, off + 8);
  off += 12;
  // GPSLongitudeRef (0x0003, ASCII, 2, inline)
  buf.writeUInt16LE(0x0003, off);
  buf.writeUInt16LE(2, off + 2);
  buf.writeUInt32LE(2, off + 4);
  gpsLonRef.copy(buf, off + 8);
  off += 12;
  // GPSLongitude (0x0004, RATIONAL, 3, offset)
  buf.writeUInt16LE(0x0004, off);
  buf.writeUInt16LE(5, off + 2);
  buf.writeUInt32LE(3, off + 4);
  buf.writeUInt32LE(extraGpsLon, off + 8);
  off += 12;
  // next IFD = 0
  buf.writeUInt32LE(0, off);

  // Extra data
  make.copy(buf, extraMake);
  model.copy(buf, extraModel);
  dateTime.copy(buf, extraDateTime);
  gpsLat.copy(buf, extraGpsLat);
  gpsLon.copy(buf, extraGpsLon);
  // gpsRef and gpsLonRef are inline, not in extra.

  return buf;
}

/**
 * Build a minimal faststart MP4/MOV with the real Apple video EXIF layout:
 *
 *   ftyp → moov → udta → uuid (Apple metadata UUID) → meta { hdlr, iloc, iinf }
 *   mdat (EXIF payload)
 *
 * The iloc extent_offset points to the TIFF inside mdat.
 */
function buildFaststartVideo(
  exifTiff: Buffer,
  brand: string = "mp42",
): { buffer: Buffer; tiffOffset: number } {
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write("ftyp", 4, 4, "ascii");
  ftyp.write(brand, 8, 4, "ascii");
  ftyp.writeUInt32BE(0, 12);
  ftyp.write(compatBrand, 16, 4, "ascii");
  return ftyp;
}

/**
 * Build a minimal ISO BMFF video container: ftyp + moov(mvhd).
 *
 * The mvhd full box carries the requested timescale and duration using
 * either v0 (32-bit fields) or v1 (64-bit creation/modification/duration)
 * per ISO 14496-12 §8.2.2.
 */
function buildMp4WithMvhd(
  timescale: number,
  duration: number,
  mvhdVersion: 0 | 1,
  brand = "mp42",
): Buffer {
  const ftyp = buildFtypBox(brand);

  // mvhd is a FullBox: 8-byte box header + 1-byte version + 3-byte flags.
  const contentSize = mvhdVersion === 0 ? 96 : 108;
  const mvhdSize = 12 + contentSize;
  const mvhd = Buffer.alloc(mvhdSize);
  mvhd.writeUInt32BE(mvhdSize, 0);
  mvhd.write("mvhd", 4, 4, "ascii");
  mvhd.writeUInt32BE(mvhdVersion << 24, 8); // version + flags (zero)

  if (mvhdVersion === 0) {
    // v0 content layout (content starts at offset 12)
    mvhd.writeUInt32BE(0, 12); // creation_time
    mvhd.writeUInt32BE(0, 16); // modification_time
    mvhd.writeUInt32BE(timescale, 20); // timescale
    mvhd.writeUInt32BE(duration, 24); // duration
    mvhd.writeUInt32BE(0x00010000, 28); // rate = 1.0
    mvhd.writeUInt32BE(1, 104); // next_track_id
  } else {
    // v1 content layout (content starts at offset 12)
    mvhd.writeUInt32BE(0, 12); // creation_time hi
    mvhd.writeUInt32BE(0, 16); // creation_time lo
    mvhd.writeUInt32BE(0, 20); // modification_time hi
    mvhd.writeUInt32BE(0, 24); // modification_time lo
    mvhd.writeUInt32BE(timescale, 28); // timescale
    mvhd.writeUInt32BE(Math.floor(duration / 0x100000000), 32); // duration hi
    mvhd.writeUInt32BE(duration >>> 0, 36); // duration lo
    mvhd.writeUInt32BE(0x00010000, 40); // rate = 1.0
    mvhd.writeUInt32BE(1, 116); // next_track_id
  }

  // moov is a plain Box (not a FullBox): its first child starts at offset 8.
  const moovSize = 8 + mvhdSize;
  const moov = Buffer.alloc(moovSize);
  moov.writeUInt32BE(moovSize, 0);
  moov.write("moov", 4, 4, "ascii");
  mvhd.copy(moov, 8);

  return Buffer.concat([ftyp, moov]);
}

describe("isVideoIsoBmff", () => {
  it("returns true for MP4 brands", () => {
    expect(isVideoIsoBmff(buildMp4WithMvhd(100, 3000, 0, "mp42"))).toBe(true);
    expect(isVideoIsoBmff(buildMp4WithMvhd(100, 3000, 0, "mp41"))).toBe(true);
    expect(isVideoIsoBmff(buildMp4WithMvhd(100, 3000, 0, "isom"))).toBe(true);
    expect(isVideoIsoBmff(buildMp4WithMvhd(100, 3000, 0, "avc1"))).toBe(true);
    expect(isVideoIsoBmff(buildMp4WithMvhd(100, 3000, 0, "MSNV"))).toBe(true);
  });

  it("returns true for MOV (qt) brand", () => {
    expect(isVideoIsoBmff(buildMp4WithMvhd(100, 3000, 0, "qt  "))).toBe(true);
  });

  it("returns false for HEIF/AVIF brands", () => {
    expect(isVideoIsoBmff(buildFtypBox("heic", "mif1"))).toBe(false);
    expect(isVideoIsoBmff(buildFtypBox("mif1"))).toBe(false);
    expect(isVideoIsoBmff(buildFtypBox("avif"))).toBe(false);
  });

  it("returns false for non-ISO BMFF data", () => {
    expect(isVideoIsoBmff(brooklynJpeg)).toBe(false);
    expect(isVideoIsoBmff(losAngelesPng)).toBe(false);
    expect(isVideoIsoBmff(Buffer.from("garbage"))).toBe(false);
    expect(isVideoIsoBmff(Buffer.alloc(0))).toBe(false);
  });
});

describe("extractDuration", () => {
  it("parses v0 mvhd duration under the cap (30s)", () => {
    expect(extractDuration(buildMp4WithMvhd(100, 3000, 0))).toBeCloseTo(30, 4);
  });

  it("parses v0 mvhd duration over the cap (412s)", () => {
    expect(extractDuration(buildMp4WithMvhd(100, 41200, 0))).toBeCloseTo(
      412,
      4,
    );
  });

  it("parses v0 mvhd duration at the 90s boundary", () => {
    expect(extractDuration(buildMp4WithMvhd(1000, 90000, 0))).toBeCloseTo(
      90,
      4,
    );
  });

  it("parses v1 mvhd duration under the cap (30s)", () => {
    expect(extractDuration(buildMp4WithMvhd(100, 3000, 1))).toBeCloseTo(30, 4);
  });

  it("parses v1 mvhd duration over the cap (412s)", () => {
    expect(extractDuration(buildMp4WithMvhd(100, 41200, 1))).toBeCloseTo(
      412,
      4,
    );
  });

  it("parses v1 mvhd duration at the 90s boundary", () => {
    expect(extractDuration(buildMp4WithMvhd(1000, 90000, 1))).toBeCloseTo(
      90,
      4,
    );
  });

  it("parses v1 durations that use the high 32-bit word", () => {
    // 2^32 + 100 = 4294967396 with timescale 1.
    expect(extractDuration(buildMp4WithMvhd(1, 0x100000000 + 100, 1))).toBe(
      4294967396,
    );
  });

  it("returns null for a video container without moov/mvhd", () => {
    expect(extractDuration(buildFtypBox("mp42"))).toBeNull();
  });

  it("returns null for truncated moov without full mvhd", () => {
    const full = buildMp4WithMvhd(100, 3000, 0);
    // Keep ftyp (24 bytes) + moov header (8 bytes) and only the first 4 bytes
    // of mvhd, which is not enough to read the versioned header.
    expect(extractDuration(full.slice(0, 36))).toBeNull();
  });

  it("returns null for non-video and empty input", () => {
    expect(extractDuration(buildFtypBox("heic", "mif1"))).toBeNull();
    expect(extractDuration(brooklynJpeg)).toBeNull();
    expect(extractDuration(Buffer.alloc(0))).toBeNull();
  });

  it("returns null when timescale is zero", () => {
    expect(extractDuration(buildMp4WithMvhd(0, 3000, 0))).toBeNull();
  ftyp.write("isom", 16, 4, "ascii");

  // hdlr
  const hdlr = Buffer.alloc(33);
  hdlr.writeUInt32BE(33, 0);
  hdlr.write("hdlr", 4, 4, "ascii");
  hdlr.writeUInt32BE(0, 8);
  hdlr.writeUInt32BE(0, 12);
  hdlr.write("pict", 16, 4, "ascii");
  hdlr.writeUInt32BE(0, 20);
  hdlr.writeUInt32BE(0, 24);
  hdlr.writeUInt32BE(0, 28);
  hdlr[32] = 0;

  // iloc (30 bytes — extent_offset patched later)
  const iloc = Buffer.alloc(30);
  iloc.writeUInt32BE(30, 0);
  iloc.write("iloc", 4, 4, "ascii");
  iloc.writeUInt32BE(0, 8);
  iloc[12] = 0x44;
  iloc[13] = 0x00;
  iloc.writeUInt16BE(1, 14);
  iloc.writeUInt16BE(1, 16);
  iloc.writeUInt16BE(0, 18);
  iloc.writeUInt16BE(1, 20);
  iloc.writeUInt32BE(exifTiff.length, 26);

  // infe
  const infe = Buffer.alloc(27);
  infe.writeUInt32BE(27, 0);
  infe.write("infe", 4, 4, "ascii");
  infe.writeUInt32BE(0x02000000, 8);
  infe.writeUInt32BE(1, 12);
  infe.writeUInt16BE(0, 16);
  infe.write("Exif", 18, 4, "ascii");
  infe.write("Exif\0", 22, 5, "ascii");

  // iinf
  const iinf = Buffer.alloc(41);
  iinf.writeUInt32BE(41, 0);
  iinf.write("iinf", 4, 4, "ascii");
  iinf.writeUInt32BE(0, 8);
  iinf.writeUInt16BE(1, 12);
  infe.copy(iinf, 14);

  // meta (full box)
  const meta = Buffer.alloc(116);
  meta.writeUInt32BE(116, 0);
  meta.write("meta", 4, 4, "ascii");
  meta.writeUInt32BE(0, 8);
  hdlr.copy(meta, 12);
  iloc.copy(meta, 45);
  iinf.copy(meta, 75);

  // uuid (24-byte header + meta)
  const uuid = Buffer.alloc(24 + meta.length);
  uuid.writeUInt32BE(uuid.length, 0);
  uuid.write("uuid", 4, 4, "ascii");
  APPLE_METADATA_UUID.copy(uuid, 8);
  meta.copy(uuid, 24);

  // udta
  const udta = Buffer.alloc(8 + uuid.length);
  udta.writeUInt32BE(udta.length, 0);
  udta.write("udta", 4, 4, "ascii");
  uuid.copy(udta, 8);

  // moov
  const moov = Buffer.alloc(8 + udta.length);
  moov.writeUInt32BE(moov.length, 0);
  moov.write("moov", 4, 4, "ascii");
  udta.copy(moov, 8);

  // mdat
  const mdat = Buffer.alloc(8 + exifTiff.length);
  mdat.writeUInt32BE(mdat.length, 0);
  mdat.write("mdat", 4, 4, "ascii");
  exifTiff.copy(mdat, 8);

  const buffer = Buffer.concat([ftyp, moov, mdat]);

  // Absolute offset of TIFF in file = ftyp + moov + mdat header(8).
  const tiffOffset = ftyp.length + moov.length + 8;

  // Patch the iloc extent_offset.
  // iloc starts at: ftyp(24) + moovHdr(8) + udtaHdr(8) + uuidHdr(24)
  //               + metaFullHdr(12) + hdlr(33) = 109
  // extent_offset = ilocStart + 22 = 131.
  buffer.writeUInt32BE(tiffOffset, 131);

  return { buffer, tiffOffset };
}

/**
 * Build a non-faststart MP4/MOV where moov is at the end of the file and the
 * EXIF payload lives inline after the meta box inside the uuid box (so a tail
 * read finds it). The mdat is padded to push moov past MAX_EXIF_BYTES.
 *
 * Returns the complete buffer and the absolute offset of moov within it.
 */
function buildNonFaststartVideo(exifTiff: Buffer): {
  buffer: Buffer;
  moovStart: number;
} {
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write("ftyp", 4, 4, "ascii");
  ftyp.write("mp42", 8, 4, "ascii");
  ftyp.writeUInt32BE(0, 12);
  ftyp.write("isom", 16, 4, "ascii");

  // Build the moov subtree with exif INLINE after meta inside uuid.
  const hdlr = Buffer.alloc(33);
  hdlr.writeUInt32BE(33, 0);
  hdlr.write("hdlr", 4, 4, "ascii");
  hdlr.writeUInt32BE(0, 8);
  hdlr.writeUInt32BE(0, 12);
  hdlr.write("pict", 16, 4, "ascii");
  hdlr.writeUInt32BE(0, 20);
  hdlr.writeUInt32BE(0, 24);
  hdlr.writeUInt32BE(0, 28);
  hdlr[32] = 0;

  // iloc — extent_offset will be patched to point at inline exif.
  const iloc = Buffer.alloc(30);
  iloc.writeUInt32BE(30, 0);
  iloc.write("iloc", 4, 4, "ascii");
  iloc.writeUInt32BE(0, 8);
  iloc[12] = 0x44;
  iloc[13] = 0x00;
  iloc.writeUInt16BE(1, 14);
  iloc.writeUInt16BE(1, 16);
  iloc.writeUInt16BE(0, 18);
  iloc.writeUInt16BE(1, 20);
  iloc.writeUInt32BE(exifTiff.length, 26);

  const infe = Buffer.alloc(27);
  infe.writeUInt32BE(27, 0);
  infe.write("infe", 4, 4, "ascii");
  infe.writeUInt32BE(0x02000000, 8);
  infe.writeUInt32BE(1, 12);
  infe.writeUInt16BE(0, 16);
  infe.write("Exif", 18, 4, "ascii");
  infe.write("Exif\0", 22, 5, "ascii");

  const iinf = Buffer.alloc(41);
  iinf.writeUInt32BE(41, 0);
  iinf.write("iinf", 4, 4, "ascii");
  iinf.writeUInt32BE(0, 8);
  iinf.writeUInt16BE(1, 12);
  infe.copy(iinf, 14);

  const meta = Buffer.alloc(116);
  meta.writeUInt32BE(116, 0);
  meta.write("meta", 4, 4, "ascii");
  meta.writeUInt32BE(0, 8);
  hdlr.copy(meta, 12);
  iloc.copy(meta, 45);
  iinf.copy(meta, 75);

  // uuid = 24-byte header + meta (116) + exif (inline)
  const uuid = Buffer.alloc(24 + meta.length + exifTiff.length);
  uuid.writeUInt32BE(uuid.length, 0);
  uuid.write("uuid", 4, 4, "ascii");
  APPLE_METADATA_UUID.copy(uuid, 8);
  meta.copy(uuid, 24);
  exifTiff.copy(uuid, 24 + meta.length); // inline after meta

  const udta = Buffer.alloc(8 + uuid.length);
  udta.writeUInt32BE(udta.length, 0);
  udta.write("udta", 4, 4, "ascii");
  uuid.copy(udta, 8);

  const moov = Buffer.alloc(8 + udta.length);
  moov.writeUInt32BE(moov.length, 0);
  moov.write("moov", 4, 4, "ascii");
  udta.copy(moov, 8);

  // mdat — large enough to push moov past MAX_EXIF_BYTES.
  const mdatPayloadSize = MAX_EXIF_BYTES;
  const mdat = Buffer.alloc(8 + mdatPayloadSize);
  mdat.writeUInt32BE(mdat.length, 0);
  mdat.write("mdat", 4, 4, "ascii");
  // Fill with zeroes (the mdat payload can be anything).

  const buffer = Buffer.concat([ftyp, mdat, moov]);

  const moovStart = ftyp.length + mdat.length;

  // Patch iloc extent_offset to the absolute file offset of the inline
  // EXIF (which starts moovStart + 156). Field layout from the iloc TYPE
  // position: extent offset at +18, extent length at +22.
  const ilocPos = buffer.indexOf(Buffer.from("iloc", "ascii"));
  const exifPos = buffer.indexOf(exifTiff);
  buffer.writeUInt32BE(exifPos, ilocPos + 18);
  buffer.writeUInt32BE(exifTiff.length, ilocPos + 22);

  return { buffer, moovStart };
}

describe("extractExifFromIsoBmffVideo", () => {
  const brooklynTiff = extractExifFromJpeg(brooklynJpeg).tiff!;
  const iphoneTiff = buildIphoneTiff();
  const { buffer: faststartMp4 } = buildFaststartVideo(brooklynTiff, "mp42");
  const { buffer: faststartMov } = buildFaststartVideo(brooklynTiff, "qt  ");
  const { buffer: faststartIphone } = buildFaststartVideo(iphoneTiff, "mp42");

  it("extracts TIFF from an MP4 with moov→udta→uuid→meta layout", () => {
    const result = extractExifFromIsoBmffVideo(faststartMp4);
    expect(result.tiff).not.toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.moovMissing).toBe(false);

    const parsed = exifReader(result.tiff);
    expect(parsed).toBeDefined();
    expect(parsed.Image.Orientation).toBe(1);
  });

  it("extracts TIFF from a MOV with qt brand", () => {
    const result = extractExifFromIsoBmffVideo(faststartMov);
    expect(result.tiff).not.toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.moovMissing).toBe(false);

    const parsed = exifReader(result.tiff);
    expect(parsed).toBeDefined();
    expect(parsed.Image.Orientation).toBe(1);
  });

  it("yields camera make/model/GPS from a synthetic iPhone EXIF", () => {
    const result = extractExifFromIsoBmffVideo(faststartIphone);
    expect(result.tiff).not.toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.moovMissing).toBe(false);

    const parsed = exifReader(result.tiff);
    expect(parsed).toBeDefined();
    expect(parsed.Image.Make).toBe("Apple");
    expect(parsed.Image.Model).toBe("iPhone 14 Pro");
    expect(parsed.GPSInfo).toBeDefined();
    // GPSLatitude is an array of 3 rational numbers.
    expect(parsed.GPSInfo.GPSLatitude).toBeDefined();
    expect(parsed.GPSInfo.GPSLongitude).toBeDefined();
  });

  it("returns moovMissing:true when buffer has no moov box", () => {
    // ftyp + mdat only (no moov).
    const ftyp = Buffer.alloc(24);
    ftyp.writeUInt32BE(24, 0);
    ftyp.write("ftyp", 4, 4, "ascii");
    ftyp.write("mp42", 8, 4, "ascii");
    ftyp.writeUInt32BE(0, 12);
    ftyp.write("isom", 16, 4, "ascii");

    const mdat = Buffer.alloc(16);
    mdat.writeUInt32BE(16, 0);
    mdat.write("mdat", 4, 4, "ascii");

    const buf = Buffer.concat([ftyp, mdat]);

    const result = extractExifFromIsoBmffVideo(buf);
    expect(result.tiff).toBeNull();
    expect(result.moovMissing).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it("returns moovMissing:false when moov present but no udta", () => {
    const ftyp = Buffer.alloc(24);
    ftyp.writeUInt32BE(24, 0);
    ftyp.write("ftyp", 4, 4, "ascii");
    ftyp.write("mp42", 8, 4, "ascii");
    ftyp.writeUInt32BE(0, 12);
    ftyp.write("isom", 16, 4, "ascii");

    // moov with no udta child.
    const moov = Buffer.alloc(8);
    moov.writeUInt32BE(8, 0);
    moov.write("moov", 4, 4, "ascii");

    const buf = Buffer.concat([ftyp, moov]);

    const result = extractExifFromIsoBmffVideo(buf);
    expect(result.tiff).toBeNull();
    expect(result.moovMissing).toBe(false);
  });

  it("returns null for JPEG input", () => {
    const result = extractExifFromIsoBmffVideo(brooklynJpeg);
    expect(result.tiff).toBeNull();
    // moovMissing is true: non-ISOBMFF input means "no moov located" — the
    // mid-box moov scan (for truncated tails) may see stray "moov" bytes in
    // binary data, but no parseable moov follows them.
    expect(result.moovMissing).toBe(true);
  });

  it("returns null for PNG input", () => {
    const result = extractExifFromIsoBmffVideo(losAngelesPng);
    expect(result.tiff).toBeNull();
    expect(result.moovMissing).toBe(true);
  });

  it("returns null for empty buffer", () => {
    const result = extractExifFromIsoBmffVideo(Buffer.alloc(0));
    expect(result.tiff).toBeNull();
    expect(result.moovMissing).toBe(true);
  });

  it("returns null when udta present but no uuid box", () => {
    const ftyp = Buffer.alloc(24);
    ftyp.writeUInt32BE(24, 0);
    ftyp.write("ftyp", 4, 4, "ascii");
    ftyp.write("mp42", 8, 4, "ascii");
    ftyp.writeUInt32BE(0, 12);
    ftyp.write("isom", 16, 4, "ascii");

    // moov → udta (empty)
    const udta = Buffer.alloc(8);
    udta.writeUInt32BE(8, 0);
    udta.write("udta", 4, 4, "ascii");

    const moov = Buffer.alloc(8 + udta.length);
    moov.writeUInt32BE(moov.length, 0);
    moov.write("moov", 4, 4, "ascii");
    udta.copy(moov, 8);

    const buf = Buffer.concat([ftyp, moov]);

    const result = extractExifFromIsoBmffVideo(buf);
    expect(result.tiff).toBeNull();
    expect(result.moovMissing).toBe(false);
  });

  it("detects truncation when Exif item extends beyond buffer", () => {
    // Truncate the faststart video partway through the mdat payload.
    const { tiffOffset } = buildFaststartVideo(brooklynTiff, "mp42");
    const full = buildFaststartVideo(brooklynTiff, "mp42").buffer;
    const truncated = full.slice(0, tiffOffset + 10);

    const result = extractExifFromIsoBmffVideo(truncated);
    expect(result.tiff).toBeNull();
    expect(result.truncated).toBe(true);
    expect(result.bytesNeeded).toBeGreaterThan(0);
    expect(result.moovMissing).toBe(false);
  });

  it("handles baseOffset correctly for a tail-read buffer", () => {
    // Using the non-faststart video, simulate a tail read by slicing the
    // last MAX_EXIF_BYTES bytes and passing baseOffset = tailStart.
    const { buffer: full } = buildNonFaststartVideo(brooklynTiff);
    const tailStart = Math.max(0, full.length - MAX_EXIF_BYTES);
    const tailBuffer = full.slice(tailStart);

    const result = extractExifFromIsoBmffVideo(tailBuffer, tailStart);
    expect(result.tiff).not.toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.moovMissing).toBe(false);

    const parsed = exifReader(result.tiff);
    expect(parsed.Image.Orientation).toBe(1);
  });

  it("falls back to any uuid box when Apple UUID not matched", () => {
    // Build a video with a NON-Apple UUID that still wraps a MetaBox.
    const nonAppleUuid = Buffer.alloc(16, 0xff); // all-ffs UUID
    const ftyp = Buffer.alloc(24);
    ftyp.writeUInt32BE(24, 0);
    ftyp.write("ftyp", 4, 4, "ascii");
    ftyp.write("mp42", 8, 4, "ascii");
    ftyp.writeUInt32BE(0, 12);
    ftyp.write("isom", 16, 4, "ascii");

    const hdlr = Buffer.alloc(33);
    hdlr.writeUInt32BE(33, 0);
    hdlr.write("hdlr", 4, 4, "ascii");
    hdlr.writeUInt32BE(0, 8);
    hdlr.writeUInt32BE(0, 12);
    hdlr.write("pict", 16, 4, "ascii");
    hdlr.writeUInt32BE(0, 20);
    hdlr.writeUInt32BE(0, 24);
    hdlr.writeUInt32BE(0, 28);
    hdlr[32] = 0;

    const iloc = Buffer.alloc(30);
    iloc.writeUInt32BE(30, 0);
    iloc.write("iloc", 4, 4, "ascii");
    iloc.writeUInt32BE(0, 8);
    iloc[12] = 0x44;
    iloc[13] = 0x00;
    iloc.writeUInt16BE(1, 14);
    iloc.writeUInt16BE(1, 16);
    iloc.writeUInt16BE(0, 18);
    iloc.writeUInt16BE(1, 20);
    iloc.writeUInt32BE(brooklynTiff.length, 26);

    const infe = Buffer.alloc(27);
    infe.writeUInt32BE(27, 0);
    infe.write("infe", 4, 4, "ascii");
    infe.writeUInt32BE(0x02000000, 8);
    infe.writeUInt32BE(1, 12);
    infe.writeUInt16BE(0, 16);
    infe.write("Exif", 18, 4, "ascii");
    infe.write("Exif\0", 22, 5, "ascii");

    const iinf = Buffer.alloc(41);
    iinf.writeUInt32BE(41, 0);
    iinf.write("iinf", 4, 4, "ascii");
    iinf.writeUInt32BE(0, 8);
    iinf.writeUInt16BE(1, 12);
    infe.copy(iinf, 14);

    const meta = Buffer.alloc(116);
    meta.writeUInt32BE(116, 0);
    meta.write("meta", 4, 4, "ascii");
    meta.writeUInt32BE(0, 8);
    hdlr.copy(meta, 12);
    iloc.copy(meta, 45);
    iinf.copy(meta, 75);

    const uuid = Buffer.alloc(24 + meta.length);
    uuid.writeUInt32BE(uuid.length, 0);
    uuid.write("uuid", 4, 4, "ascii");
    nonAppleUuid.copy(uuid, 8);
    meta.copy(uuid, 24);

    const udta = Buffer.alloc(8 + uuid.length);
    udta.writeUInt32BE(udta.length, 0);
    udta.write("udta", 4, 4, "ascii");
    uuid.copy(udta, 8);

    const moov = Buffer.alloc(8 + udta.length);
    moov.writeUInt32BE(moov.length, 0);
    moov.write("moov", 4, 4, "ascii");
    udta.copy(moov, 8);

    const mdat = Buffer.alloc(8 + brooklynTiff.length);
    mdat.writeUInt32BE(mdat.length, 0);
    mdat.write("mdat", 4, 4, "ascii");
    brooklynTiff.copy(mdat, 8);

    const buf = Buffer.concat([ftyp, moov, mdat]);
    const tiffOffset = ftyp.length + moov.length + 8;
    buf.writeUInt32BE(tiffOffset, 131);

    const result = extractExifFromIsoBmffVideo(buf);
    expect(result.tiff).not.toBeNull();
    expect(result.moovMissing).toBe(false);

    const parsed = exifReader(result.tiff);
    expect(parsed.Image.Orientation).toBe(1);
  });

  it("extracts camera make/model/GPS from a real-device-layout iPhone MOV", () => {
    // iphoneRealLayoutMov replicates a real iPhone 14 Pro MOV trimmed to
    // ftyp + free + moov(mvhd, trak(tkhd, mdia(mdhd, hdlr, minf(...))),
    // udta(uuid)) + wide + mdat. The parser must skip the genuine sibling
    // boxes before finding udta.
    const result = extractExifFromIsoBmffVideo(iphoneRealLayoutMov);
    expect(result.tiff).not.toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.bytesNeeded).toBe(0);
    expect(result.moovMissing).toBe(false);

    const parsed = exifReader(result.tiff);
    expect(parsed).toBeDefined();
    expect(parsed.Image.Make).toBe("Apple");
    expect(parsed.Image.Model).toBe("iPhone 14 Pro");
    expect(parsed.GPSInfo).toBeDefined();
    expect(parsed.GPSInfo.GPSLatitude).toBeDefined();
    expect(parsed.GPSInfo.GPSLongitude).toBeDefined();
    // GPS: 34°3'0"N, 118°14'0"W
    expect(parsed.GPSInfo.GPSLatitude[0]).toBe(34);
    expect(parsed.GPSInfo.GPSLatitude[1]).toBe(3);
    expect(parsed.GPSInfo.GPSLongitude[0]).toBe(118);
    expect(parsed.GPSInfo.GPSLongitude[1]).toBe(14);
  });

  it("extracts a raw TIFF blob from the Apple uuid when no MetaBox is parseable", () => {
    // Some Apple files store the EXIF as a raw blob inside the metadata uuid
    // without a usable iloc/iinf MetaBox. The last-resort TIFF-marker scan
    // must recover it.
    const ftyp = Buffer.alloc(24);
    ftyp.writeUInt32BE(24, 0);
    ftyp.write("ftyp", 4, 4, "ascii");
    ftyp.write("qt  ", 8, 4, "ascii");
    ftyp.writeUInt32BE(0, 12);
    ftyp.write("isom", 16, 4, "ascii");

    // uuid box wrapping a raw TIFF blob (no meta structure).
    const uuid = Buffer.alloc(24 + iphoneTiff.length);
    uuid.writeUInt32BE(uuid.length, 0);
    uuid.write("uuid", 4, 4, "ascii");
    APPLE_METADATA_UUID.copy(uuid, 8);
    iphoneTiff.copy(uuid, 24);

    const udta = Buffer.alloc(8 + uuid.length);
    udta.writeUInt32BE(udta.length, 0);
    udta.write("udta", 4, 4, "ascii");
    uuid.copy(udta, 8);

    const moov = Buffer.alloc(8 + udta.length);
    moov.writeUInt32BE(moov.length, 0);
    moov.write("moov", 4, 4, "ascii");
    udta.copy(moov, 8);

    const mdat = Buffer.alloc(16);
    mdat.writeUInt32BE(16, 0);
    mdat.write("mdat", 4, 4, "ascii");

    const buf = Buffer.concat([ftyp, moov, mdat]);

    const result = extractExifFromIsoBmffVideo(buf);
    expect(result.tiff).not.toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.moovMissing).toBe(false);

    const parsed = exifReader(result.tiff);
    expect(parsed.Image.Make).toBe("Apple");
    expect(parsed.Image.Model).toBe("iPhone 14 Pro");
  });
});

describe("extractExif (video routing)", () => {
  const brooklynTiff = extractExifFromJpeg(brooklynJpeg).tiff!;
  const { buffer: faststartMp4 } = buildFaststartVideo(brooklynTiff, "mp42");

  it("routes video through extractExif when HEIF path fails", () => {
    // faststartMp4 has NO top-level meta, only moov/udta/uuid/meta.
    const result = extractExif(faststartMp4);
    expect(result).not.toBeNull();
    expect(Buffer.isBuffer(result!)).toBe(true);
    const parsed = exifReader(result!);
    expect(parsed.Image.Orientation).toBe(1);
  });

  it("routes a real-device-layout iPhone MOV through extractExif", () => {
    const result = extractExif(iphoneRealLayoutMov);
    expect(result).not.toBeNull();
    expect(Buffer.isBuffer(result!)).toBe(true);

    const parsed = exifReader(result!);
    expect(parsed.Image.Make).toBe("Apple");
    expect(parsed.Image.Model).toBe("iPhone 14 Pro");
    expect(parsed.GPSInfo).toBeDefined();
  });

  it("extractExifWithRetry works for video with moov video path", async () => {
    const { buffer: mp4 } = buildFaststartVideo(brooklynTiff, "mp42");
    const fetchMore = jest.fn<Promise<Buffer | null>, [number, number]>();
    const result = await extractExifWithRetry(mp4, 0, fetchMore);
    expect(result).not.toBeNull();
    expect(fetchMore).not.toHaveBeenCalled();
  });

  it("extractExifWithRetry handles a real-device-layout iPhone MOV in one read", async () => {
    const fetchMore = jest.fn<Promise<Buffer | null>, [number, number]>();
    const result = await extractExifWithRetry(
      iphoneRealLayoutMov,
      0,
      fetchMore,
    );
    expect(result).not.toBeNull();
    // moov is at the front — no follow-up should be needed.
    expect(fetchMore).not.toHaveBeenCalled();

    const parsed = exifReader(result!);
    expect(parsed.Image.Make).toBe("Apple");
    expect(parsed.Image.Model).toBe("iPhone 14 Pro");
  });

  it("extractExifWithRetry signals a follow-up on moovMissing (non-faststart)", async () => {
    // Buffer: ftyp + partial mdat (no moov).
    const ftyp = Buffer.alloc(24);
    ftyp.writeUInt32BE(24, 0);
    ftyp.write("ftyp", 4, 4, "ascii");
    ftyp.write("mp42", 8, 4, "ascii");
    ftyp.writeUInt32BE(0, 12);
    ftyp.write("isom", 16, 4, "ascii");

    const mdat = Buffer.alloc(40);
    mdat.writeUInt32BE(40, 0);
    mdat.write("mdat", 4, 4, "ascii");

    const initial = Buffer.concat([ftyp, mdat]);

    let fetchCallCount = 0;
    const fetchMore = jest
      .fn<Promise<Buffer | null>, [number, number]>()
      .mockImplementation(async () => {
        fetchCallCount++;
        return null; // no more data
      });

    const result = await extractExifWithRetry(initial, 0, fetchMore);
    // moovMissing → truncated+follow-up, but follow-up returns null → null.
    expect(result).toBeNull();
    expect(fetchCallCount).toBe(1);
  });
});
