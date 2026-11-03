import { lambdaPost, lambdaGet } from "../testLambdaHandler";
import dbHelper from "../dbHelper";
import { Upload } from "../../entity/Upload";
import { Location } from "../../entity/Location";
import {
  LOCALITY_ONLY_ADDRESSES,
  PARTIAL_MATCH_ADDRESS,
  stubGeocode,
  stubGeocodeFailure,
} from "../fixtures/geocode";

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
    // BUG-037: a missing/invalid address is no longer an error at all — only
    // file problems (and system-level geocoding failures) are reported.
    expect(body.errors.address).toBeUndefined();
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

  // -----------------------------------------------------------------------
  // BUG-037: geocoder-unnormalizable addresses (locality-only Places picks,
  // route-level partial matches) must NOT 422 the upload — the photo is
  // stored without a location and /report validates its own address.
  // -----------------------------------------------------------------------
  describe("BUG-037: unnormalizable addresses", () => {
    let restoreGeocode: (() => void) | null = null;

    afterEach(() => {
      restoreGeocode?.();
      restoreGeocode = null;
    });

    test.each([...LOCALITY_ONLY_ADDRESSES, PARTIAL_MATCH_ADDRESS])(
      "POST /upload with %s creates a location-less upload",
      async (address) => {
        restoreGeocode = stubGeocode(async () => null);

        const response = await lambdaPost("/upload", {
          fileHash: `hash-for-${address}`,
          fileName: "photo.jpeg",
          address,
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.errors).not.toBeDefined();
        expect(body.filePath).toMatch(
          /^uploads\/unknown-location-[0-9a-f]{8}\.jpeg$/,
        );

        // Row persisted with no location (uploads.location_id is nullable
        // since #341) and matching raw path.
        const upload = await Upload.findOne({ where: { id: body.id } });
        expect(upload).not.toBeNull();
        expect(upload!.location).toBeNull();
        expect(upload!.filePath).toEqual(body.filePath);
        expect(upload!.rawFilePath).toEqual(body.filePath);
        expect(await Location.count()).toEqual(0);
      },
    );

    test("POST /upload keeps linking a location for a full street address", async () => {
      const response = await lambdaPost("/upload", {
        fileHash: "unique-hash-123-full-street",
        fileName: "brooklyn-ny.jpeg",
        address: "5335 S Kimbark Ave Chicago IL 60615",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.filePath).toMatch(/^uploads\/chicago-il-/);

      const upload = await Upload.findOne({ where: { id: body.id } });
      expect(upload!.location).not.toBeNull();
      expect(upload!.location!.city).toEqual("Chicago");
      expect(upload!.location!.state).toEqual("IL");
    });

    test("geocoding system failure still returns 503 and creates no rows", async () => {
      restoreGeocode = stubGeocodeFailure("Google Maps API is down");

      const response = await lambdaPost("/upload", {
        fileHash: "hash-geocoding-down",
        fileName: "photo.jpeg",
        address: "5335 S Kimbark Ave Chicago IL 60615",
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.errors.address).toEqual(
        "Address verification is temporarily unavailable. Please try again later.",
      );
      expect(await Upload.count()).toEqual(0);
    });

    test("missing fileHash still returns 422 with errors.fileName only", async () => {
      restoreGeocode = stubGeocode(async () => null);

      const response = await lambdaPost("/upload", {
        fileName: "photo.jpeg",
        address: LOCALITY_ONLY_ADDRESSES[0],
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body);
      expect(body.errors.fileName).toBeDefined();
      expect(body.errors.address).toBeUndefined();
      expect(await Upload.count()).toEqual(0);
    });
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
