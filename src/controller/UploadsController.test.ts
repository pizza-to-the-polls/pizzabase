import * as http_mocks from "node-mocks-http";

import { UploadsController } from "./UploadsController";
import { Upload } from "../entity/Upload";
import { Location } from "../entity/Location";
import { FILE_TYPE_ERROR, ADDRESS_ERROR } from "../lib/validator/constants";

jest.mock("../lib/aws");
jest.mock("../lib/validator/geocode");
jest.mock("exif-reader");
jest.mock("aws-sdk");

const controller = new UploadsController();

// Build a minimal JPEG image with an APP1 Exif marker so that
// extractExif() can find the segment and pass it to exif-reader.
// Structure: SOI (FFD8) + APP1 marker (FFE1 len "Exif\0\0") + TIFF + SOS + EOI
function buildMinimalJpegWithExif(): Buffer {
  // TIFF header: "II" (little-endian) + 0x002A (42, TIFF magic) + offset to IFD
  const tiff = Buffer.from([
    0x49,
    0x49, // "II" little-endian
    0x2a,
    0x00, // TIFF magic 42
    0x08,
    0x00,
    0x00,
    0x00, // offset to IFD (8)
    0x00,
    0x00, // IFD entry count = 0
  ]);

  // EXIF payload inside APP1: "Exif\0\0" + TIFF
  const exifPayload = Buffer.concat([Buffer.from("Exif\0\0"), tiff]);

  // APP1 marker
  const app1Len = exifPayload.length + 2; // +2 for the length field itself
  const app1Header = Buffer.from([
    0xff,
    0xe1,
    (app1Len >> 8) & 0xff,
    app1Len & 0xff,
  ]);

  // Build the JPEG
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    app1Header,
    exifPayload,
    Buffer.from([0xff, 0xda, 0x00, 0x02, 0x00, 0x01, 0x00, 0x00]), // dummy SOS
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

describe("#create", () => {
  it("returns validation errors", async () => {
    const response = http_mocks.createResponse();
    const body = await controller.create(
      http_mocks.createRequest({
        ip: "127.0.0.1",
        method: "POST",
        body: {},
      }),
      response,
      () => undefined
    );
    expect(body).toEqual({
      errors: {
        address: ADDRESS_ERROR,
        fileName: FILE_TYPE_ERROR,
      },
    });
    expect(response.statusCode).toEqual(422);
  });

  it("returns validation error for bad filename", async () => {
    const response = http_mocks.createResponse();
    const body = await controller.create(
      http_mocks.createRequest({
        ip: "127.0.0.1",
        method: "POST",
        body: { address: "1234 Street City ST 12345", fileName: "dumb.pdf" },
      }),
      response,
      () => undefined
    );
    expect(body).toEqual({
      errors: {
        fileName: FILE_TYPE_ERROR,
      },
    });
    expect(response.statusCode).toEqual(422);
  });

  it("returns error if rate limited", async () => {
    const response = http_mocks.createResponse();
    const ip = "127.0.0.1";
    const location = await Location.createFromAddress({
      latitude: 41.79907,
      longitude: -87.58413,

      fullAddress: "5335 S Kimbark Ave Chicago IL 60615",

      address: "5335 S Kimbark Ave",
      city: "Chicago",
      state: "IL",
      zip: "60615",
    });
    await Promise.all(
      Array(6)
        .fill(null)
        .map(async (_, i) => {
          const upload = new Upload();
          upload.ipAddress = ip;
          upload.filePath = `${i}.png`;
          upload.location = location;
          upload.fileHash = `${i}-hash`;
          await upload.save();
        })
    );
    const body = await controller.create(
      http_mocks.createRequest({
        ip,
        method: "POST",
        body: {
          address: "1234 Street City ST 12345",
          fileName: "dumb.gif",
          fileHash: "unique",
        },
      }),
      response,
      () => undefined
    );
    expect(body).toEqual({
      errors: {
        fileName:
          "Whoops! You've had too many uploads recently - slow your roll",
      },
    });
    expect(response.statusCode).toEqual(429);
  });

  it("returns original upload if uploaded", async () => {
    const response = http_mocks.createResponse();
    const ip = "127.0.0.1";
    const location = await Location.createFromAddress({
      latitude: 41.79907,
      longitude: -87.58413,

      fullAddress: "5335 S Kimbark Ave Chicago IL 60615",

      address: "5335 S Kimbark Ave",
      city: "Chicago",
      state: "IL",
      zip: "60615",
    });

    const upload = new Upload();
    upload.ipAddress = ip;
    upload.filePath = "dumb.gif";
    upload.location = location;
    upload.fileHash = "same";
    await upload.save();

    const body = await controller.create(
      http_mocks.createRequest({
        ip,
        method: "POST",
        body: {
          address: "1234 Street City ST 12345",
          fileName: "dumb.gif",
          fileHash: "same",
        },
      }),
      response,
      () => undefined
    );
    expect((body as any).isDuplicate).toEqual(true);
    expect((body as any).id).toEqual(upload.id);
    expect((body as any).filePath).toEqual(upload.filePath);
  });

  it("can create an upload on an existing location", async () => {
    const address = "5335 S Kimbark Ave Chicago IL 60615";
    const location = await Location.createFromAddress({
      latitude: 41.79907,
      longitude: -87.58413,

      fullAddress: address,

      address: "5335 S Kimbark Ave",
      city: "Chicago",
      state: "IL",
      zip: "60615",
    });
    const body = await controller.create(
      http_mocks.createRequest({
        ip: "127.0.0.1",
        method: "POST",
        body: { address, fileName: "file.png", fileHash: "same-loc" },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    const upload = await Upload.findOne({ order: { id: "DESC" }, where: {} });

    expect((body as any).isDuplicate).toEqual(false);
    expect((body as any).id).toEqual(upload.id);
    expect((body as any).filePath).toEqual(upload.filePath);
    expect(upload.fileHash).toEqual("same-loc");
    expect(upload.filePath).toContain(".png");
    expect(upload.location.id).toEqual(location.id);
  });

  it("can create an upload on a new location", async () => {
    await controller.create(
      http_mocks.createRequest({
        ip: "127.0.0.1",
        method: "POST",
        body: {
          fileName: "thing.jpg",
          address: "550 Different Address City OR 12345",
          fileHash: "new-loc",
        },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    const upload = await Upload.findOne({ order: { id: "DESC" }, where: {} });

    expect(upload.fileHash).toEqual("new-loc");
    expect(upload.location.fullAddress).toEqual(
      "550 Different Address City OR 12345"
    );
  });

  it("surfaces geocoding system failures as 503 with a user-friendly message", async () => {
    const mockModule = require("../lib/validator/geocode");
    const originalGeocode = mockModule.geocode;
    mockModule.geocode = jest
      .fn()
      .mockRejectedValueOnce(new mockModule.GeocodingError("missing API key"));

    try {
      const response = http_mocks.createResponse();
      const body = await controller.create(
        http_mocks.createRequest({
          ip: "127.0.0.1",
          method: "POST",
          body: {
            fileName: "thing.jpg",
            address: "550 Different Address City OR 12345",
            fileHash: "geo-fail",
          },
        }),
        response,
        () => undefined
      );

      expect(response.statusCode).toEqual(503);
      expect(body).toEqual({
        errors: {
          address:
            "Address verification is temporarily unavailable. Please try again later.",
        },
      });
    } finally {
      mockModule.geocode = originalGeocode;
    }
  });

  it("sets media_status to processing on create", async () => {
    await controller.create(
      http_mocks.createRequest({
        ip: "127.0.0.6",
        method: "POST",
        body: {
          fileName: "processing-test.jpg",
          address: "550 Processing Ave City OR 12345",
          fileHash: "processing-status",
        },
      }),
      http_mocks.createResponse(),
      () => undefined
    );

    const upload = await Upload.findOne({
      order: { id: "DESC" },
      where: {},
    });

    expect(upload.mediaStatus).toEqual("processing");
    expect(upload.rawFilePath).toBeDefined();
    expect(upload.rawFilePath).toEqual(upload.filePath);
  });
});

describe("#getExif", () => {
  let upload: Upload;
  let fileName: string;

  beforeEach(async () => {
    const address = {
      latitude: 45.523064,
      longitude: -122.676483,
      fullAddress: "123 Main St, Portland, OR 97204",
      address: "123 Main St",
      city: "Portland",
      state: "OR",
      zip: "97204",
    };

    [upload] = await Upload.createOrReject("127.0.0.1", {
      fileExt: "jpg",
      fileHash: "somehash1",
      normalizedAddress: address,
    });

    fileName = upload.filePath.split("/")[1];
  });

  it("returns exif_data from JSONB (fast path) when populated", async () => {
    // Populate the JSONB column — simulates data written by the
    // EXIF-processing Lambda
    upload.exifData = {
      image: { Make: "Apple", Model: "iPhone 15" },
      _review: {
        source: "camera",
        hasGps: false,
        software: null,
        camera: "Apple iPhone 15",
        capturedAt: null,
        dimensions: null,
      },
    };
    await upload.save();

    const response = http_mocks.createResponse();
    const body = await controller.getExif(
      http_mocks.createRequest({
        method: "GET",
        url: `/uploads/exif/${fileName}`,
        params: { fileName },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response,
      () => undefined
    );

    expect(response.statusCode).toEqual(200);
    expect(body.image.Make).toEqual("Apple");
    expect(body.image.Model).toEqual("iPhone 15");
    expect(body._review.source).toEqual("camera");
    // No S3 call should have been made — fast path returns directly
  });

  it("falls back to S3 when exif_data is null (legacy uploads)", async () => {
    // Mock S3 to return a minimal JPEG with EXIF
    const jpegBuffer = buildMinimalJpegWithExif();

    const mockAws = require("aws-sdk");
    mockAws.S3 = jest.fn().mockImplementation(() => ({
      getObject: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Body: jpegBuffer,
        }),
      }),
    }));

    const exifReader = require("exif-reader");
    exifReader.mockReturnValueOnce({
      image: { Make: "Apple", Model: "iPhone 15" },
      bigEndian: false,
    });

    const response = http_mocks.createResponse();
    const body = await controller.getExif(
      http_mocks.createRequest({
        method: "GET",
        url: `/uploads/exif/${fileName}`,
        params: { fileName },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response,
      () => undefined
    );

    expect(response.statusCode).toEqual(200);
    // Should contain serialised EXIF + review summary
    expect(body).toBeDefined();
    expect(body._review).toBeDefined();
    expect(body._review.source).toBe("camera");
    expect(body.image.Make).toEqual("Apple");
    expect(body.image.Model).toEqual("iPhone 15");
  });

  it("should return null for an upload with no exif data in either path", async () => {
    const mockAws = require("aws-sdk");
    // Return a JPEG without an EXIF APP1 marker
    const noExifJpeg = Buffer.from([
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
    mockAws.S3 = jest.fn().mockImplementation(() => ({
      getObject: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Body: noExifJpeg,
        }),
      }),
    }));

    const response = http_mocks.createResponse();
    const body = await controller.getExif(
      http_mocks.createRequest({
        method: "GET",
        url: `/uploads/exif/${fileName}`,
        params: { fileName },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response,
      () => undefined
    );

    expect(response.statusCode).toEqual(200);
    expect(body).toBe(null);
  });

  it("should return 401 for a request without an API key", async () => {
    const response = http_mocks.createResponse();
    await controller.getExif(
      http_mocks.createRequest({
        method: "GET",
        url: `/uploads/exif/${fileName}`,
        params: { fileName },
      }),
      response,
      () => undefined
    );

    expect(response.statusCode).toEqual(401);
  });

  it("should return 401 for a request with a bad API key", async () => {
    const response = http_mocks.createResponse();
    await controller.getExif(
      http_mocks.createRequest({
        method: "GET",
        url: `/uploads/exif/${fileName}`,
        params: { fileName },
        headers: { Authorization: "Basic badkey" },
      }),
      response,
      () => undefined
    );

    expect(response.statusCode).toEqual(401);
  });

  it("should return 404 for a non-existent upload", async () => {
    const response = http_mocks.createResponse();
    await controller.getExif(
      http_mocks.createRequest({
        method: "GET",
        url: `/uploads/exif/not-real.jpg`,
        params: { fileName: "not-real.jpg" },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response,
      () => undefined
    );

    expect(response.statusCode).toEqual(404);
  });
});

describe("#mediaFormatCallback", () => {
  let upload: Upload;

  beforeEach(async () => {
    const address = {
      latitude: 45.523064,
      longitude: -122.676483,
      fullAddress: "123 Main St, Portland, OR 97204",
      address: "123 Main St",
      city: "Portland",
      state: "OR",
      zip: "97204",
    };

    [upload] = await Upload.createOrReject("127.0.0.2", {
      fileExt: "png",
      fileHash: "callback-test",
      normalizedAddress: address,
    });
  });

  it("updates media_status to ready with processed_file_path", async () => {
    const response = http_mocks.createResponse();
    const body = await controller.mediaFormatCallback(
      http_mocks.createRequest({
        method: "POST",
        body: {
          id: upload.id,
          status: "ready",
          processed_file_path: {
            webp: "https://example.com/uploads/1.webp",
            jpeg: "https://example.com/uploads/1.jpeg",
          },
        },
      }),
      response,
      () => undefined
    );

    expect(body).toEqual({ ok: true, id: upload.id, mediaStatus: "ready" });

    const updated = await Upload.findOne({
      where: { id: upload.id } as any,
    });
    expect(updated.mediaStatus).toEqual("ready");
    expect(updated.processedFilePath).toEqual({
      webp: "https://example.com/uploads/1.webp",
      jpeg: "https://example.com/uploads/1.jpeg",
    });
  });

  it("updates media_status to failed when processing fails", async () => {
    const response = http_mocks.createResponse();
    const body = await controller.mediaFormatCallback(
      http_mocks.createRequest({
        method: "POST",
        body: {
          id: upload.id,
          status: "failed",
        },
      }),
      response,
      () => undefined
    );

    expect(body).toEqual({ ok: true, id: upload.id, mediaStatus: "failed" });

    const updated = await Upload.findOne({
      where: { id: upload.id } as any,
    });
    expect(updated.mediaStatus).toEqual("failed");
  });

  it("returns 400 for missing id", async () => {
    const response = http_mocks.createResponse();
    const body = await controller.mediaFormatCallback(
      http_mocks.createRequest({
        method: "POST",
        body: { status: "ready" },
      }),
      response,
      () => undefined
    );

    expect(response.statusCode).toEqual(400);
    expect(body.errors._general).toBeDefined();
  });

  it("returns 400 for invalid status", async () => {
    const response = http_mocks.createResponse();
    const body = await controller.mediaFormatCallback(
      http_mocks.createRequest({
        method: "POST",
        body: { id: upload.id, status: "cooking" },
      }),
      response,
      () => undefined
    );

    expect(response.statusCode).toEqual(400);
    expect(body.errors._general).toContain("Invalid status");
  });

  it("returns 404 for unknown upload id", async () => {
    const response = http_mocks.createResponse();
    const body = await controller.mediaFormatCallback(
      http_mocks.createRequest({
        method: "POST",
        body: { id: 999999, status: "ready" },
      }),
      response,
      () => undefined
    );

    expect(response.statusCode).toEqual(404);
    expect(body.errors._general).toEqual("Upload not found");
  });
});
