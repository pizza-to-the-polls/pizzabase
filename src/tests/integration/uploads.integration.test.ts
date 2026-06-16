import { lambdaPost } from "../testLambdaHandler";
import dbHelper from "../dbHelper";

// These must be mocked before the deferred app import inside testLambdaHandler
// triggers the real module load.
jest.mock("../../lib/validator/geocode");
jest.mock("../../lib/aws");

describe("Uploads API (via Lambda handler)", () => {
  afterEach(async () => {
    await dbHelper.cleanAll();
  });

  test("POST /upload with valid data creates an upload", async () => {
    const response = await lambdaPost("/upload", {
      fileHash: "unique-hash-123",
      fileName: "brooklyn-ny.jpeg",
      address: "5335 S Kimbark Ave Chicago IL 60615",
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    // Should contain upload info OR a duplicate flag, not a generic address error
    expect(body.errors).not.toBeDefined();
    expect(body.filePath).toBeDefined();
  });

  test("POST /upload with missing fields returns 422", async () => {
    const response = await lambdaPost("/upload", {});

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.errors).toBeDefined();
    expect(body.errors.fileName).toBeDefined();
    expect(body.errors.address).toBeDefined();
  });

  test("POST /upload with invalid file type returns 422", async () => {
    const response = await lambdaPost("/upload", {
      fileHash: "some-hash",
      fileName: "malicious.exe",
      address: "5335 S Kimbark Ave Chicago IL 60615",
    });

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.errors.fileName).toBeDefined();
  });
});
