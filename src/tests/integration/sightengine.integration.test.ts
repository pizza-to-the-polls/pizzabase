import { lambdaPost } from "../testLambdaHandler";
import dbHelper from "../dbHelper";

jest.mock("../../lib/validator/geocode");
jest.mock("../../lib/aws");
jest.mock("aws-sdk");
jest.mock("exif-reader");

describe("SightEngine integration (via Lambda handler)", () => {
  afterEach(async () => {
    await dbHelper.cleanAll();
  });

  test("POST /upload without includeReview does not include review key", async () => {
    const response = await lambdaPost("/upload", {
      fileHash: "no-review-hash",
      fileName: "brooklyn-ny.jpeg",
      address: "5335 S Kimbark Ave Chicago IL 60615",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.filePath).toBeDefined();
    expect(body.review).toBeUndefined();
  });
});
