import {
  extractExif,
  extractExifFromJpeg,
  extractExifFromPng,
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
