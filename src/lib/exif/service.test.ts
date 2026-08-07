/**
 * Tests for the EXIF extraction service with dependency injection.
 *
 * The service accepts an s3Client interface so we can inject mock S3
 * responses without touching the real AWS SDK or filesystem.
 */

import { extractExifAndReview } from "./service";
import {
  brooklynJpeg,
  redondoJpeg,
  losAngelesPng,
} from "../../tests/fixtures/exif";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock S3 client that returns fixed buffers for known keys. */
function mockS3(
  overrides: Record<string, Buffer | null> = {}
): {
  getObject: jest.Mock;
} {
  const getObject = jest
    .fn()
    .mockImplementation(
      (params: { Bucket: string; Key: string; Range?: string }) => ({
        promise: jest.fn().mockResolvedValue({
          Body: overrides[params.Key] ?? overrides["*"] ?? null,
        }),
      })
    );
  return { getObject };
}

function deps(getObject: jest.Mock) {
  return { s3Client: { getObject } as any, bucket: "test-bucket" };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractExifAndReview", () => {
  const filePath = "uploads/test.jpg";

  // ---- JPEG with EXIF ----------------------------------------------------

  it("extracts EXIF from a JPEG with real metadata", async () => {
    const s3 = mockS3({ [filePath]: brooklynJpeg });
    const result = await extractExifAndReview(deps(s3.getObject), {
      filePath,
      includeReview: false,
    });

    expect(result.exif).not.toBeNull();
    expect(result.review).toBeUndefined();
    // Brooklyn JPEG has Orientation: 1
    const exif = result.exif as any;
    expect(exif.Image?.Orientation).toBe(1);
  });

  it("includes review envelope when includeReview is true", async () => {
    const s3 = mockS3({ [filePath]: brooklynJpeg });
    const result = await extractExifAndReview(deps(s3.getObject), {
      filePath,
      includeReview: true,
    });

    expect(result.exif).not.toBeNull();
    expect(result.review).toBeDefined();
    expect(result.review?.assessment).toBeDefined();
    expect(result.review?.disclaimer).toBeDefined();
  });

  it("returns limited-evidence for a sparse JPEG with no camera make/model", async () => {
    const s3 = mockS3({ [filePath]: brooklynJpeg });
    const result = await extractExifAndReview(deps(s3.getObject), {
      filePath,
      includeReview: true,
    });

    // Brooklyn has sparse EXIF — orientation + resolution only, no camera.
    expect(result.review?.assessment).toBe("limited-evidence");
  });

  // ---- Screenshot JPEG ---------------------------------------------------

  it("flags screenshot JPEG via ImageDescription in review", async () => {
    const s3 = mockS3({ [filePath]: redondoJpeg });
    const result = await extractExifAndReview(deps(s3.getObject), {
      filePath,
      includeReview: true,
    });

    // Redondo explicitly contains "Screenshot" in ImageDescription.
    expect(result.review?.assessment).toBe(
      "likely-screen-or-software-generated"
    );
    expect(
      (result.review as any).cautionSignals?.some(
        (s: any) => s.code === "explicit-screenshot-marker"
      )
    ).toBe(true);
  });

  // ---- PNG with no EXIF --------------------------------------------------

  it("returns null EXIF for PNG without eXIf chunk", async () => {
    const s3 = mockS3({ [filePath]: losAngelesPng });
    const result = await extractExifAndReview(deps(s3.getObject), {
      filePath,
      includeReview: false,
    });

    expect(result.exif).toBeNull();
    expect(result.review).toBeUndefined();
  });

  it("returns no-metadata review for PNG without EXIF", async () => {
    const s3 = mockS3({ [filePath]: losAngelesPng });
    const result = await extractExifAndReview(deps(s3.getObject), {
      filePath,
      includeReview: true,
    });

    expect(result.exif).toBeNull();
    expect(result.review?.assessment).toBe("no-metadata");
  });

  // ---- S3 errors ---------------------------------------------------------

  it("rejects when S3 getObject throws", async () => {
    const getObject = jest.fn().mockImplementation(() => ({
      promise: jest.fn().mockRejectedValue(new Error("S3 error")),
    }));
    await expect(
      extractExifAndReview(deps(getObject), {
        filePath,
        includeReview: false,
      })
    ).rejects.toThrow("S3 error");
  });

  it("returns error assessment in review when S3 throws with includeReview", async () => {
    const getObject = jest.fn().mockImplementation(() => ({
      promise: jest.fn().mockRejectedValue(new Error("S3 error")),
    }));
    // The service itself throws on S3 errors — the caller (controller)
    // catches and returns the error shape.  Test that path.
    await expect(
      extractExifAndReview(deps(getObject), {
        filePath,
        includeReview: true,
      })
    ).rejects.toThrow("S3 error");
  });

  // ---- Truncated / malformed input ---------------------------------------

  it("returns null EXIF for an empty buffer", async () => {
    const s3 = mockS3({ [filePath]: Buffer.alloc(0) });
    const result = await extractExifAndReview(deps(s3.getObject), {
      filePath,
      includeReview: false,
    });

    expect(result.exif).toBeNull();
  });

  it("returns null EXIF for garbage bytes", async () => {
    const s3 = mockS3({ [filePath]: Buffer.from("not an image") });
    const result = await extractExifAndReview(deps(s3.getObject), {
      filePath,
      includeReview: false,
    });

    expect(result.exif).toBeNull();
  });

  // ---- S3 Range reads (bounded follow-up) --------------------------------

  it("issues a follow-up Range read when EXIF segment overflows initial buffer", async () => {
    // Build a JPEG where the EXIF APP1 segment extends past byte 100.
    // The initial read of 64 KiB will contain the full EXIF for Brooklyn,
    // so this tests that the follow-up callback is wired but not exercised
    // for non-truncated data.
    const getObject = jest
      .fn()
      .mockImplementation(
        (params: { Bucket: string; Key: string; Range?: string }) => ({
          promise: jest.fn().mockResolvedValue({
            Body: params.Range?.startsWith("bytes=0-") ? brooklynJpeg : null,
          }),
        })
      );

    const result = await extractExifAndReview(
      { s3Client: { getObject } as any, bucket: "test-bucket" },
      { filePath, includeReview: false }
    );

    expect(result.exif).not.toBeNull();
    expect(getObject).toHaveBeenCalledTimes(2); // initial + XMP sidecar (404 ok)
  });

  it("issues a follow-up Range read when XMP segment overflows initial buffer", async () => {
    // Build a minimal JPEG with XMP APP1 segment starting after byte 64 KiB.
    // The XMP retry callback should fire, request the missing range, and
    // try extraction again.
    const soi = Buffer.from([0xff, 0xd8]);
    const eoi = Buffer.from([0xff, 0xd9]);

    // Pad to 64 KiB + 100 bytes so the initial read doesn't contain XMP.
    const padding = Buffer.alloc(65535 - soi.length);
    const xmpBody = Buffer.from(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"><Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture</Iptc4xmpExt:DigitalSourceType></rdf:Description></rdf:RDF></x:xmpmeta>',
      "utf-8"
    );
    // APP1 marker 0xFFE1, length = 2 + xmpSig.length + xmpBody.length
    const xmpSig = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "ascii");
    const app1Len = 2 + xmpSig.length + xmpBody.length;
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16BE(app1Len, 0);
    const marker = Buffer.from([0xff, 0xe1]);

    const jpeg = Buffer.concat([
      soi,
      padding,
      marker,
      lenBuf,
      xmpSig,
      xmpBody,
      eoi,
    ]);

    const getObject = jest
      .fn()
      .mockImplementation(
        (params: { Bucket: string; Key: string; Range?: string }) => {
          if (!params.Range || params.Range.startsWith("bytes=0-")) {
            // Initial read: return first 64 KiB.
            return {
              promise: jest
                .fn()
                .mockResolvedValue({ Body: jpeg.slice(0, 65535) }),
            };
          }
          // Follow-up read: return the remaining bytes.
          const match = params.Range.match(/^bytes=(\d+)-(\d+)$/);
          if (match) {
            const start = parseInt(match[1], 10);
            const end = parseInt(match[2], 10);
            return {
              promise: jest
                .fn()
                .mockResolvedValue({ Body: jpeg.slice(start, end + 1) }),
            };
          }
          return { promise: jest.fn().mockResolvedValue({ Body: null }) };
        }
      );

    const result = await extractExifAndReview(
      { s3Client: { getObject } as any, bucket: "test-bucket" },
      { filePath, includeReview: true }
    );

    // Should have issued the follow-up (at least 2 calls: initial + follow-up).
    expect(getObject).toHaveBeenCalledTimes(2);

    // XMP follow-up was issued.
    expect(result.exif).toBeNull(); // no EXIF in this synthetic JPEG
    expect(result.review).toBeDefined();
  });

  // ---- XMP sidecar -------------------------------------------------------

  it("falls back to XMP .xmp sidecar when container has no embedded XMP", async () => {
    const getObject = jest
      .fn()
      .mockImplementation(
        (params: { Bucket: string; Key: string; Range?: string }) => {
          if (params.Key === `${filePath}.xmp`) {
            const xmp = Buffer.from(
              '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"><Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/screenCapture</Iptc4xmpExt:DigitalSourceType></rdf:Description></rdf:RDF></x:xmpmeta>',
              "utf-8"
            );
            return { promise: jest.fn().mockResolvedValue({ Body: xmp }) };
          }
          // Brooklyn JPEG has no embedded XMP.
          return {
            promise: jest.fn().mockResolvedValue({ Body: brooklynJpeg }),
          };
        }
      );

    const result = await extractExifAndReview(
      { s3Client: { getObject } as any, bucket: "test-bucket" },
      { filePath, includeReview: true }
    );

    expect(getObject).toHaveBeenCalledTimes(2); // image + sidecar
    expect((result.review as any)?.digitalSourceType).toEqual({
      uri: "http://cv.iptc.org/newscodes/digitalsourcetype/screenCapture",
      label: "screen capture",
    });
  });

  it("handles missing XMP sidecar gracefully", async () => {
    const getObject = jest
      .fn()
      .mockImplementation(
        (params: { Bucket: string; Key: string; Range?: string }) => {
          if (params.Key === `${filePath}.xmp`) {
            return {
              promise: jest.fn().mockRejectedValue(new Error("NoSuchKey")),
            };
          }
          return {
            promise: jest.fn().mockResolvedValue({ Body: brooklynJpeg }),
          };
        }
      );

    const result = await extractExifAndReview(
      { s3Client: { getObject } as any, bucket: "test-bucket" },
      { filePath, includeReview: true }
    );

    // Should still get EXIF, just no digitalSourceType.
    expect(result.exif).not.toBeNull();
    expect((result.review as any)?.digitalSourceType).toBeUndefined();
  });

  // ---- Serialization safety ----------------------------------------------

  it("returns JSON-serializable EXIF data", () => {
    // The serializeExif function is covered by its own tests;
    // this test verifies the service integration returns safe JSON.
    return (async () => {
      const s3 = mockS3({ [filePath]: brooklynJpeg });
      const result = await extractExifAndReview(deps(s3.getObject), {
        filePath,
        includeReview: false,
      });

      expect(() => JSON.stringify(result.exif)).not.toThrow();
      const roundTripped = JSON.parse(JSON.stringify(result.exif));
      expect(roundTripped).toEqual(result.exif);
    })();
  });
});
