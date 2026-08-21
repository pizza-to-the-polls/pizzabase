import { lambdaPost, lambdaGet } from "../testLambdaHandler";
import dbHelper from "../dbHelper";
import { Upload } from "../../entity/Upload";
import { Location } from "../../entity/Location";

// These must be mocked before the deferred app import inside testLambdaHandler
// triggers the real module load.
jest.mock("../../lib/validator/geocode");
jest.mock("../../lib/aws");
jest.mock("../../lib/sightengine/client", () => ({
  checkImage: jest.fn().mockResolvedValue({ score: 0.42 }),
}));

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

describe("SightEngine endpoint (via Lambda handler)", () => {
  let fileName: string;

  beforeEach(async () => {
    const location = await Location.createFromAddress({
      latitude: 45.523064,
      longitude: -122.676483,
      fullAddress: "123 Main St, Portland, OR 97204",
      address: "123 Main St",
      city: "Portland",
      state: "OR",
      zip: "97204",
    });

    const upload = new Upload();
    upload.ipAddress = "127.0.0.1";
    upload.filePath = "uploads/integration-test-sightengine.jpg";
    upload.fileHash = "integration-sightengine-hash";
    upload.location = location;
    await upload.save();

    fileName = "integration-test-sightengine.jpg";
  });

  test("GET /uploads/:fileName/sightengine returns score with cached=false on first call", async () => {
    const response = await lambdaGet(`/uploads/${fileName}/sightengine`, {
      Authorization: `Basic ${process.env.GOOD_API_KEY}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual({ score: 0.42, cached: false });
  });

  test("GET /uploads/:fileName/sightengine returns cached=true on second call", async () => {
    // First call (uncached)
    await lambdaGet(`/uploads/${fileName}/sightengine`, {
      Authorization: `Basic ${process.env.GOOD_API_KEY}`,
    });

    // Second call (should be cached now)
    const response = await lambdaGet(`/uploads/${fileName}/sightengine`, {
      Authorization: `Basic ${process.env.GOOD_API_KEY}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual({ score: 0.42, cached: true });
  });

  test("GET /uploads/:fileName/sightengine without auth returns 401", async () => {
    const response = await lambdaGet(`/uploads/${fileName}/sightengine`);

    expect(response.statusCode).toBe(401);
  });

  test("GET /uploads/:fileName/sightengine returns 404 for non-existent upload", async () => {
    const response = await lambdaGet(
      "/uploads/does-not-exist.jpg/sightengine",
      { Authorization: `Basic ${process.env.GOOD_API_KEY}` },
    );

    expect(response.statusCode).toBe(404);
  });
});
