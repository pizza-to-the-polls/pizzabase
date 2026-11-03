import { validateUpload } from "./validateUpload";
import { FILE_HASH_ERROR, FILE_TYPE_ERROR } from "./constants";
import {
  FULL_STREET_ADDRESS,
  FULL_STREET_NORMALIZED,
  UNNORMALIZABLE_ADDRESSES,
  stubGeocode,
} from "../../tests/fixtures/geocode";

// Uses the __mocks__ geocode module by default (no network); each test that
// cares about a specific geocoder outcome swaps in a stub and restores it in
// afterEach.
jest.mock("./geocode");

const geocodeModule = require("./geocode");
const originalGeocode = geocodeModule.geocode;

afterEach(() => {
  geocodeModule.geocode = originalGeocode;
});

describe("validateUpload", () => {
  describe("BUG-037: unnormalizable addresses do not block photo uploads", () => {
    it.each(UNNORMALIZABLE_ADDRESSES)(
      "accepts %s with no errors and a null normalized address",
      async (address: string) => {
        stubGeocode(async () => null);

        const result = await validateUpload({
          fileHash: "a-hash",
          fileName: "photo.jpeg",
          address,
        });

        // The point of BUG-037: a geocoder-unnormalizable address is NOT a
        // client error — the upload proceeds without a location.
        expect(result.errors).toEqual({});
        expect(result.normalizedAddress).toBeNull();
        expect(result.fileHash).toEqual("a-hash");
        expect(result.fileExt).toEqual("jpeg");
      },
    );

    it("reports no address error when the address is omitted entirely", async () => {
      const result = await validateUpload({
        fileHash: "a-hash",
        fileName: "photo.jpeg",
      });

      expect(result.errors).toEqual({});
      expect(result.normalizedAddress).toBeNull();
    });

    it("keeps reporting file errors alongside a null normalized address", async () => {
      stubGeocode(async () => null);

      // Missing hash + unnormalizable address: only the file error remains.
      const result = await validateUpload({
        fileName: "photo.jpeg",
        address: UNNORMALIZABLE_ADDRESSES[0],
      });

      expect(result.errors).toEqual({ fileName: FILE_HASH_ERROR });
      expect(result.normalizedAddress).toBeNull();
    });
  });

  describe("full street addresses are unchanged", () => {
    it("returns the normalized address with no errors", async () => {
      stubGeocode(async (address?: string) =>
        address === FULL_STREET_ADDRESS ? FULL_STREET_NORMALIZED : null,
      );

      const result = await validateUpload({
        fileHash: "a-hash",
        fileName: "photo.jpeg",
        address: FULL_STREET_ADDRESS,
      });

      expect(result.errors).toEqual({});
      expect(result.normalizedAddress).toEqual(FULL_STREET_NORMALIZED);
      expect(result.fileExt).toEqual("jpeg");
    });
  });

  describe("system-level geocoding failures", () => {
    it("surfaces a _geocoding error (503 path) and no address error", async () => {
      stubGeocode(async () => {
        const { GeocodingError } = require("./geocode");
        throw new GeocodingError("Google Maps API is down");
      });

      const result = await validateUpload({
        fileHash: "a-hash",
        fileName: "photo.jpeg",
        address: FULL_STREET_ADDRESS,
      });

      expect(result.errors._geocoding).toEqual("Google Maps API is down");
      // The `address` validation error no longer exists at all (BUG-037) —
      // the ValidationError type has no `address` key, so this is enforced
      // at compile time too.
      expect(result.normalizedAddress).toBeNull();
      expect(result.fileHash).toEqual("a-hash");
    });
  });

  describe("file validation is unchanged", () => {
    it("reports a missing fileHash", async () => {
      const result = await validateUpload({
        fileName: "photo.jpeg",
        address: FULL_STREET_ADDRESS,
      });

      expect(result.errors).toEqual({ fileName: FILE_HASH_ERROR });
      expect(result.fileHash).toBeUndefined();
    });

    it("reports an invalid file extension", async () => {
      const result = await validateUpload({
        fileHash: "a-hash",
        fileName: "malicious.exe",
        address: FULL_STREET_ADDRESS,
      });

      expect(result.errors).toEqual({ fileName: FILE_TYPE_ERROR });
      expect(result.fileExt).toEqual("exe");
    });
  });

  describe("return contract", () => {
    it("always returns fileExt, fileHash and normalizedAddress keys", async () => {
      stubGeocode(async () => null);

      const result = await validateUpload({});

      expect(Object.keys(result).sort()).toEqual([
        "errors",
        "fileExt",
        "fileHash",
        "normalizedAddress",
      ]);
    });
  });
});
