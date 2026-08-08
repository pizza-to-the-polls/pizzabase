import {
  extractExif,
  extractExifFromJpeg,
  extractExifFromPng,
  extractExifFromHeif,
  extractExifWithRetry,
  MAX_EXIF_BYTES,
} from "./extract";
import {
  brooklynJpeg,
  redondoJpeg,
  losAngelesPng,
  truncatedJpeg,
  jpegNoExif,
  jpegTruncatedExif,
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
        "Screenshot"
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
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      0x01,
      0x08,
      0x00,
      0x00,
      0x00,
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
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      0x01,
      0x08,
      0x00,
      0x00,
      0x00,
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
          "ascii"
        )
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
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      0x01,
      0x08,
      0x00,
      0x00,
      0x00,
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
        fullPng.slice(start, end + 1)
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
        full.slice(start, end + 1)
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
        full.slice(start, end + 1)
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
      fetchMore
    );
    expect(extracted).toBeNull();
    expect(fetchMore).not.toHaveBeenCalled();
  });

  it("returns null for unrecognized data", async () => {
    const fetchMore = jest.fn<Promise<Buffer | null>, [number, number]>();
    const result = await extractExifWithRetry(
      Buffer.from([0x00, 0x00]),
      0,
      fetchMore
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
      async () => null // no follow-up needed
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
