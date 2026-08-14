import * as http_mocks from "node-mocks-http";

import { SightEngineController } from "./SightEngineController";
import { Upload } from "../entity/Upload";

// Mock the SightEngine client module so we control the API call behavior
jest.mock("../lib/sightengine/client", () => ({
  checkImage: jest.fn(),
}));

const controller = new SightEngineController();

describe("#getSightEngineScore", () => {
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
      fileHash: `sightengine-test-${Date.now()}-${Math.random()}`,
      normalizedAddress: address,
    });

    fileName = upload.filePath.split("/")[1];
  });

  it("should return a cached score when the DB already has one", async () => {
    // Pre-seed a score in the DB
    upload.sightengineScore = 0.95;
    await upload.save();

    const response = http_mocks.createResponse();
    const body = await controller.getSightEngineScore(
      http_mocks.createRequest({
        method: "GET",
        url: `/uploads/${fileName}/sightengine`,
        params: { fileName },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response,
      () => undefined,
    );

    expect(response.statusCode).toEqual(200);
    expect(body).toEqual({ score: 0.95, cached: true });
  });

  it("should call SightEngine API when DB has null score and return uncached", async () => {
    const { checkImage } = require("../lib/sightengine/client");
    checkImage.mockResolvedValueOnce({ score: 0.5 });

    const response = http_mocks.createResponse();
    const body = await controller.getSightEngineScore(
      http_mocks.createRequest({
        method: "GET",
        url: `/uploads/${fileName}/sightengine`,
        params: { fileName },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response,
      () => undefined,
    );

    expect(response.statusCode).toEqual(200);
    expect(body).toEqual({ score: 0.5, cached: false });

    // Verify the score was persisted to the DB
    const updated = await Upload.findOne({
      where: { filePath: upload.filePath } as any,
    });
    expect(updated!.sightengineScore).toEqual(0.5);
  });

  it("should return cached on second call after a fresh API call", async () => {
    const { checkImage } = require("../lib/sightengine/client");
    checkImage.mockResolvedValueOnce({ score: 0.3 });

    // First call: uncached
    const response1 = http_mocks.createResponse();
    const body1 = await controller.getSightEngineScore(
      http_mocks.createRequest({
        method: "GET",
        url: `/uploads/${fileName}/sightengine`,
        params: { fileName },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response1,
      () => undefined,
    );

    expect(response1.statusCode).toEqual(200);
    expect(body1).toEqual({ score: 0.3, cached: false });

    // Second call: cached (no additional mock needed for checkImage)
    const response2 = http_mocks.createResponse();
    const body2 = await controller.getSightEngineScore(
      http_mocks.createRequest({
        method: "GET",
        url: `/uploads/${fileName}/sightengine`,
        params: { fileName },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response2,
      () => undefined,
    );

    expect(response2.statusCode).toEqual(200);
    expect(body2).toEqual({ score: 0.3, cached: true });
  });

  it("should return 401 for a request without an API key", async () => {
    const response = http_mocks.createResponse();
    await controller.getSightEngineScore(
      http_mocks.createRequest({
        method: "GET",
        url: `/uploads/${fileName}/sightengine`,
        params: { fileName },
      }),
      response,
      () => undefined,
    );

    expect(response.statusCode).toEqual(401);
  });

  it("should return 401 for a request with a bad API key", async () => {
    const response = http_mocks.createResponse();
    await controller.getSightEngineScore(
      http_mocks.createRequest({
        method: "GET",
        url: `/uploads/${fileName}/sightengine`,
        params: { fileName },
        headers: { Authorization: "Basic badkey" },
      }),
      response,
      () => undefined,
    );

    expect(response.statusCode).toEqual(401);
  });

  it("should return 404 for a non-existent upload", async () => {
    const response = http_mocks.createResponse();
    await controller.getSightEngineScore(
      http_mocks.createRequest({
        method: "GET",
        url: `/uploads/not-real.jpg/sightengine`,
        params: { fileName: "not-real.jpg" },
        headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
      }),
      response,
      () => undefined,
    );

    expect(response.statusCode).toEqual(404);
  });

  it("should propagate API errors when checkImage fails", async () => {
    const { checkImage } = require("../lib/sightengine/client");
    checkImage.mockRejectedValueOnce(
      new Error("SightEngine API error: 500 Internal Server Error"),
    );

    const response = http_mocks.createResponse();
    await expect(
      controller.getSightEngineScore(
        http_mocks.createRequest({
          method: "GET",
          url: `/uploads/${fileName}/sightengine`,
          params: { fileName },
          headers: { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
        }),
        response,
        () => undefined,
      ),
    ).rejects.toThrow("SightEngine API error: 500 Internal Server Error");
  });
});
