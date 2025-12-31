import * as http_mocks from "node-mocks-http";
import * as aws from "aws-sdk";
import { UploadsController } from "./UploadsController";
import { Upload } from "../entity/Upload";
import { Location } from "../entity/Location";
import { FILE_TYPE_ERROR, ADDRESS_ERROR } from "../lib/validator/constants";

jest.mock("aws-sdk", () => {
  const mS3 = {
    getObject: jest.fn().mockReturnThis(),
    promise: jest.fn(),
  };
  return { S3: jest.fn(() => mS3) };
});
jest.mock("../lib/aws");
jest.mock("../lib/validator/geocode");

const controller = new UploadsController();
const s3 = new aws.S3();

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
});

describe("#getExif", () => {
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

    [upload] = await Upload.createOrReject("127.0.0.1", {
      fileExt: "jpg",
      fileHash: "somehash1",
      normalizedAddress: address,
    });
  });

  it("should return exif data for an upload that has it", async () => {
    // A realistic but fake exif buffer
    const exifBuffer = Buffer.from([
      0x45,
      0x78,
      0x69,
      0x66,
      0x00,
      0x00,
      0x4d,
      0x4d,
      0x00,
      0x2a,
      0x00,
      0x00,
      0x00,
      0x08,
      0x00,
      0x02,
      0x01,
      0x1a,
      0x00,
      0x05,
      0x00,
      0x00,
      0x00,
      0x01,
    ]);
    (s3.getObject().promise as jest.Mock).mockResolvedValue({
      Body: exifBuffer,
    });

    const response = http_mocks.createResponse();
    const body = await controller.getExif(
      http_mocks.createRequest({
        method: "GET",
        url: `/uploads/${upload.id}/exif`,
        params: { id: upload.id },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response,
      () => undefined
    );

    expect(response.statusCode).toEqual(200);
    // exif-reader will return a partially parsed object for this fake buffer
    expect(body).toEqual({ Image: null, bigEndian: true });
  });

  it("should return null for an upload that does not have exif data", async () => {
    (s3.getObject().promise as jest.Mock).mockResolvedValue({
      Body: Buffer.from([]),
    });

    const response = http_mocks.createResponse();
    const body = await controller.getExif(
      http_mocks.createRequest({
        method: "GET",
        url: `/uploads/${upload.id}/exif`,
        params: { id: upload.id },
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
        url: `/uploads/${upload.id}/exif`,
        params: { id: upload.id },
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
        url: `/uploads/${upload.id}/exif`,
        params: { id: upload.id },
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
        url: `/uploads/999999/exif`,
        params: { id: 999999 },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response,
      () => undefined
    );

    expect(response.statusCode).toEqual(404);
  });
});
