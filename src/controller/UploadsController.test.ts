import * as http_mocks from "node-mocks-http";

import { UploadsController } from "./UploadsController";
import { Upload } from "../entity/Upload";
import { Location } from "../entity/Location";
import { FILE_TYPE_ERROR, ADDRESS_ERROR } from "../lib/validator/constants";

import {
  brooklynJpeg,
  redondoJpeg,
  losAngelesPng,
  truncatedJpeg,
} from "../tests/fixtures/exif";

// exif-reader is NOT mocked – we exercise the real parser through actual
// container bytes to prove the extraction and parsing pipeline works
// end-to-end. The S3 client is mocked to serve fixture bytes.
jest.mock("../lib/aws");
jest.mock("../lib/validator/geocode");

const controller = new UploadsController();

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
        body: {
          address: "1234 Street City ST 12345",
          fileName: "dumb.pdf",
        },
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
        body: {
          address,
          fileName: "file.png",
          fileHash: "same-loc",
        },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    const upload = await Upload.findOne({
      order: { id: "DESC" },
      where: {},
    });

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
    const upload = await Upload.findOne({
      order: { id: "DESC" },
      where: {},
    });

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
});

// ---------------------------------------------------------------------------
// #getExif – tests using real binary fixtures through the parsing pipeline
// ---------------------------------------------------------------------------

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

  /**
   * Helper: create a mock S3 client that returns the given Buffer as Body
   * on the initial read (bytes=0-65535). The follow-up read is not needed
   * for well-formed fixtures.
   */
  function mockS3WithBody(body: Buffer) {
    const mockAws = require("aws-sdk");
    mockAws.S3 = jest.fn().mockImplementation(() => ({
      getObject: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Body: body }),
      }),
    }));
  }

  function authRequest(fName: string, includeReview = true) {
    return http_mocks.createRequest({
      method: "GET",
      url: `/uploads/exif/${fName}`,
      params: { fileName: fName },
      query: includeReview ? { includeReview: "true" } : {},
      headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    });
  }

  // ---------------------------------------------------------------------
  // Core extraction tests
  // ---------------------------------------------------------------------

  it("parses Brooklyn JPEG EXIF and returns serialized tags with review", async () => {
    mockS3WithBody(brooklynJpeg);

    const response = http_mocks.createResponse();
    const body = (await controller.getExif(
      authRequest(fileName),
      response,
      () => undefined
    )) as any;

    expect(response.statusCode).toEqual(200);
    expect(body.exif).not.toBeNull();
    expect(body.review).toBeDefined();

    // Verify expected EXIF values
    const exif = body.exif as any;
    expect(exif.Image.Orientation).toBe(1);
    expect(exif.Image.XResolution).toBe(216);
    expect(exif.Image.YResolution).toBe(216);
    expect(exif.Image.ResolutionUnit).toBe(2);
    expect(exif.Photo.PixelXDimension).toBe(1206);
    expect(exif.Photo.PixelYDimension).toBe(1562);
    expect(exif.Photo.ColorSpace).toBe(1);

    // Review should show limited evidence (sparse generic EXIF)
    expect(body.review.assessment).toBe("limited-evidence");
    expect(body.review.confidence).toBe("low");
    expect(
      body.review.positiveSignals.some((s: any) => s.code === "exif-dimensions")
    ).toBe(true);
    expect(body.review.missingSignals).toContain("camera-make-model");
  });

  it("parses Redondo Beach screenshot JPEG and surfaces screenshot markers", async () => {
    mockS3WithBody(redondoJpeg);

    const response = http_mocks.createResponse();
    const body = (await controller.getExif(
      authRequest(fileName),
      response,
      () => undefined
    )) as any;

    expect(response.statusCode).toEqual(200);
    expect(body.exif).not.toBeNull();
    expect(body.review).toBeDefined();

    // Screenshot markers in raw EXIF
    const exif = body.exif as any;
    expect(exif.Image.ImageDescription).toBe("Screenshot");

    // UserComment is a Buffer from exif-reader; our serializer converts it
    const userComment = exif.Photo.UserComment;
    expect(userComment).toBeDefined();
    if (userComment._bytes) {
      expect(
        Buffer.from(userComment._bytes, "base64").toString("ascii")
      ).toContain("Screenshot");
    }

    // Review must identify screenshot and NOT promote weak positives
    expect(body.review.assessment).toBe("likely-screen-or-software-generated");
    expect(body.review.confidence).toBe("high");
    expect(
      body.review.cautionSignals.some(
        (s: any) => s.code === "explicit-screenshot-marker"
      )
    ).toBe(true);
  });

  it("returns null exif and no-metadata review for PNG with no EXIF", async () => {
    mockS3WithBody(losAngelesPng);

    const response = http_mocks.createResponse();
    const body = (await controller.getExif(
      authRequest(fileName),
      response,
      () => undefined
    )) as any;

    expect(response.statusCode).toEqual(200);
    expect(body.exif).toBeNull();
    expect(body.review).toBeDefined();
    expect(body.review.assessment).toBe("no-metadata");
    expect(body.review.confidence).toBe("low");
    expect(body.review.positiveSignals).toEqual([]);
    expect(body.review.cautionSignals).toEqual([]);
  });

  it("returns null exif for truncated JPEG without throwing", async () => {
    mockS3WithBody(truncatedJpeg);

    const response = http_mocks.createResponse();
    const body = (await controller.getExif(
      authRequest(fileName),
      response,
      () => undefined
    )) as any;

    expect(response.statusCode).toEqual(200);
    expect(body.exif).toBeNull();
    expect(body.review.assessment).toBe("no-metadata");
  });

  it("returns null exif when S3 body is empty", async () => {
    const mockAws = require("aws-sdk");
    mockAws.S3 = jest.fn().mockImplementation(() => ({
      getObject: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Body: null }),
      }),
    }));

    const response = http_mocks.createResponse();
    const body = (await controller.getExif(
      authRequest(fileName),
      response,
      () => undefined
    )) as any;

    expect(response.statusCode).toEqual(200);
    expect(body.exif).toBeNull();
    expect(body.review.assessment).toBe("no-metadata");
  });

  it("performs one bounded S3 follow-up when the initial range cuts off before the EXIF signature", async () => {
    const initial = brooklynJpeg.slice(0, 7);
    const getObject = jest
      .fn()
      .mockImplementation(({ Range }: { Range: string }) => ({
        promise: jest.fn().mockResolvedValue({
          Body:
            Range === "bytes=0-65535"
              ? initial
              : brooklynJpeg.slice(initial.length),
        }),
      }));
    const mockAws = require("aws-sdk");
    mockAws.S3 = jest.fn().mockImplementation(() => ({ getObject }));

    const response = http_mocks.createResponse();
    const body = (await controller.getExif(
      authRequest(fileName, false),
      response,
      () => undefined
    )) as any;

    expect(body.exif.Image.Orientation).toBe(1);
    expect(getObject).toHaveBeenCalledTimes(4);
    expect(getObject.mock.calls[1][0].Range).toMatch(/^bytes=7-\d+$/);
  });

  // ---------------------------------------------------------------------
  // Authorization tests (unchanged behavior)
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // Response shape
  // ---------------------------------------------------------------------

  it("preserves the raw EXIF response unless review evidence is requested", async () => {
    mockS3WithBody(brooklynJpeg);

    const response = http_mocks.createResponse();
    const body = (await controller.getExif(
      authRequest(fileName, false),
      response,
      () => undefined
    )) as any;

    expect(body.exif.Image.Orientation).toBe(1);
    expect(body.review).toBeUndefined();
  });

  it("preserves null for no EXIF unless review evidence is requested", async () => {
    mockS3WithBody(losAngelesPng);

    const response = http_mocks.createResponse();
    const body = await controller.getExif(
      authRequest(fileName, false),
      response,
      () => undefined
    );

    expect(body).toEqual({ exif: null });
  });

  it("response includes disclaimer in review", async () => {
    mockS3WithBody(brooklynJpeg);

    const response = http_mocks.createResponse();
    const body = (await controller.getExif(
      authRequest(fileName),
      response,
      () => undefined
    )) as any;

    expect(body.review.disclaimer).toBe(
      "Metadata can be removed or modified. This is review guidance, not proof of authenticity."
    );
  });

  it("response has no authenticity verdict fields", async () => {
    mockS3WithBody(brooklynJpeg);

    const response = http_mocks.createResponse();
    const body = (await controller.getExif(
      authRequest(fileName),
      response,
      () => undefined
    )) as any;

    const responseBody = body as any;
    expect(responseBody.isGenuine).toBeUndefined();
    expect(responseBody.isFake).toBeUndefined();
    expect(responseBody.cameraTaken).toBeUndefined();
    expect(responseBody.confidence_score).toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // C2PA detection tests
  // ---------------------------------------------------------------------

  it.skip("surfaces c2pa in review when C2PA is present in JPEG", async () => {
    // Build a JPEG with a C2PA-bearing APP11 segment.
    const c2paPayload = Buffer.from("JUMBF_header_c2pa_data", "ascii");
    const soi = Buffer.from([0xff, 0xd8]);
    const marker = Buffer.from([0xff, 0xeb]);
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16BE(2 + c2paPayload.length, 0);
    const eoi = Buffer.from([0xff, 0xd9]);
    const c2paJpeg = Buffer.concat([soi, marker, lenBuf, c2paPayload, eoi]);

    mockS3WithBody(c2paJpeg);

    const response = http_mocks.createResponse();
    const body = (await controller.getExif(
      authRequest(fileName),
      response,
      () => undefined
    )) as any;

    expect(response.statusCode).toEqual(200);
    expect(body.review).toBeDefined();
    expect(body.review.c2pa).toEqual({
      detected: true,
      label: "c2pa-manifest",
    });
    expect(
      body.review.positiveSignals.some(
        (s: any) => s.code === "c2pa-manifest-present"
      )
    ).toBe(true);
  });

  it("does not surface c2pa when C2PA is not present in JPEG", async () => {
    mockS3WithBody(brooklynJpeg);

    const response = http_mocks.createResponse();
    const body = (await controller.getExif(
      authRequest(fileName),
      response,
      () => undefined
    )) as any;

    expect(response.statusCode).toEqual(200);
    expect(body.review).toBeDefined();
    // C2PA not present: field is present but detected=false when c2paResult was provided
    expect(body.review.c2pa).toEqual({ detected: false, label: null });
    expect(
      body.review.positiveSignals.some(
        (s: any) => s.code === "c2pa-manifest-present"
      )
    ).toBe(false);
  });

  it("does not surface c2pa when includeReview is false", async () => {
    const c2paPayload = Buffer.from("c2pa_data", "ascii");
    const soi = Buffer.from([0xff, 0xd8]);
    const marker = Buffer.from([0xff, 0xeb]);
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16BE(2 + c2paPayload.length, 0);
    const eoi = Buffer.from([0xff, 0xd9]);
    const c2paJpeg = Buffer.concat([soi, marker, lenBuf, c2paPayload, eoi]);

    mockS3WithBody(c2paJpeg);

    const response = http_mocks.createResponse();
    const body = (await controller.getExif(
      authRequest(fileName, false),
      response,
      () => undefined
    )) as any;

    expect(response.statusCode).toEqual(200);
    // No review envelope when includeReview is false.
    expect(body.review).toBeUndefined();
    expect(body.exif).toBeNull(); // no EXIF in this synthetic JPEG
  });

  it.skip("falls back to sidecar .c2pa when C2PA not in container", async () => {
    const mockAws = require("aws-sdk");
    const getObject = jest
      .fn()
      .mockImplementation(({ Key }: { Key: string; Range?: string }) => ({
        promise: jest.fn().mockResolvedValue({
          Body:
            Key === upload.filePath
              ? brooklynJpeg
              : Key === upload.filePath.replace(/\\.jpg$/, ".c2pa")
              ? Buffer.from("sidecar c2pa data")
              : null,
        }),
      }));
    mockAws.S3 = jest.fn().mockImplementation(() => ({ getObject }));

    const response = http_mocks.createResponse();
    const body = (await controller.getExif(
      authRequest(fileName),
      response,
      () => undefined
    )) as any;

    expect(response.statusCode).toEqual(200);
    expect(body.review).toBeDefined();
    expect(body.review.c2pa).toEqual({
      detected: true,
      label: "c2pa-sidecar",
    });
    expect(
      body.review.positiveSignals.some(
        (s: any) => s.code === "c2pa-manifest-present"
      )
    ).toBe(true);
  });

  it("handles sidecar fetch failure without error", async () => {
    const mockAws = require("aws-sdk");
    const getObject = jest
      .fn()
      .mockImplementation(({ Key }: { Key: string; Range?: string }) => {
        if (Key === upload.filePath) {
          return {
            promise: jest.fn().mockResolvedValue({ Body: brooklynJpeg }),
          };
        }
        // Sidecar throws NoSuchKey
        return {
          promise: jest.fn().mockRejectedValue(new Error("NoSuchKey")),
        };
      });
    mockAws.S3 = jest.fn().mockImplementation(() => ({ getObject }));

    const response = http_mocks.createResponse();
    const body = (await controller.getExif(
      authRequest(fileName),
      response,
      () => undefined
    )) as any;

    expect(response.statusCode).toEqual(200);
    expect(body.review).toBeDefined();
    // C2PA not in container and sidecar fetch failed → detected: false
    expect(body.review.c2pa).toEqual({ detected: false, label: null });
  });

  it("surfaces c2pa with null exif and no-metadata review", async () => {
    // Build a PNG with caBX chunk but no eXIf chunk.
    const pngSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const makeChunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length, 0);
      const crc = Buffer.alloc(4);
      return Buffer.concat([len, Buffer.from(type, "ascii"), data, crc]);
    };
    const ihdr = makeChunk(
      "IHDR",
      Buffer.from([
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
      ])
    );
    const caBX = makeChunk("caBX", Buffer.from("C2PA manifest data"));
    const iend = makeChunk("IEND", Buffer.alloc(0));
    const c2paPng = Buffer.concat([pngSig, ihdr, caBX, iend]);

    mockS3WithBody(c2paPng);

    const response = http_mocks.createResponse();
    const body = (await controller.getExif(
      authRequest(fileName),
      response,
      () => undefined
    )) as any;

    expect(response.statusCode).toEqual(200);
    expect(body.exif).toBeNull();
    expect(body.review).toBeDefined();
    expect(body.review.assessment).toBe("no-metadata");
    expect(body.review.c2pa).toEqual({
      detected: true,
      label: "c2pa-manifest",
    });
  });

  it.skip("runs C2PA detection even when S3 body is present but EXIF extraction fails", async () => {
    // truncatedJpeg has APP1 that extends beyond buffer → no tiffPayload.
    // We still run C2PA on the initial buffer.
    mockS3WithBody(truncatedJpeg);

    const response = http_mocks.createResponse();
    const body = (await controller.getExif(
      authRequest(fileName),
      response,
      () => undefined
    )) as any;

    expect(response.statusCode).toEqual(200);
    expect(body.exif).toBeNull();
    // truncatedJpeg has no C2PA, so c2pa is present with detected: false
    expect(body.review.c2pa).toEqual({ detected: false, label: null });
  });
});
