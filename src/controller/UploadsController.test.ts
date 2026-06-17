import * as http_mocks from "node-mocks-http";

import { UploadsController } from "./UploadsController";
import { Upload } from "../entity/Upload";
import { Location } from "../entity/Location";
import { FILE_TYPE_ERROR, ADDRESS_ERROR } from "../lib/validator/constants";

jest.mock("../lib/aws");
jest.mock("../lib/validator/geocode");
jest.mock("exif-reader");

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

  it("should return exif data for an upload that has it", async () => {
    const mockAws = require("aws-sdk");
    mockAws.S3 = jest.fn().mockImplementation(() => ({
      getObject: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Body: Buffer.from([0x45, 0x78]),
        }),
      }),
    }));

    const exifReader = require("exif-reader");
    exifReader.mockReturnValueOnce({
      Image: { Make: "Apple" },
      bigEndian: true,
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
    expect(body).toEqual({ Image: { Make: "Apple" }, bigEndian: true });
  });

  it("should return null for an upload that does not have exif data", async () => {
    const mockAws = require("aws-sdk");
    mockAws.S3 = jest.fn().mockImplementation(() => ({
      getObject: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Body: Buffer.from([0x00, 0x00]),
        }),
      }),
    }));

    const exifReader = require("exif-reader");
    exifReader.mockImplementationOnce(() => {
      throw new Error("No EXIF data");
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
