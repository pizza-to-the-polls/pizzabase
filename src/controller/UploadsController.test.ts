import * as http_mocks from "node-mocks-http";

import { UploadsController } from "./UploadsController";
import { Upload } from "../entity/Upload";
import { Location } from "../entity/Location";
import { FILE_TYPE_ERROR, ADDRESS_ERROR } from "../lib/validator/constants";

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

  it("returns error if repeat upload", async () => {
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
      Array(1)
        .fill(null)
        .map(async (_, i) => {
          const upload = new Upload();
          upload.ipAddress = ip;
          upload.filePath = `${i}.png`;
          upload.location = location;
          upload.fileHash = "same";
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
          fileHash: "same",
        },
      }),
      response,
      () => undefined
    );
    expect(body).toEqual({
      errors: {
        fileName: "Hmmmm - we've already seen this photo. How about a new one?",
      },
    });
    expect(response.statusCode).toEqual(429);
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
    const upload = await Upload.findOne({ order: { id: "DESC" } });

    expect((body as any).id).toEqual(upload.id);
    expect((body as any).filePath).toEqual(upload.filePath);
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
    const upload = await Upload.findOne({ order: { id: "DESC" } });

    expect(upload.location.fullAddress).toEqual(
      "550 Different Address City OR 12345"
    );
  });
});
