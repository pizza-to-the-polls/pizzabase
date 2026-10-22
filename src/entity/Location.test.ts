import { Location } from "./Location";
import { NormalAddress } from "../lib/validator";

const ADDRESS: NormalAddress = {
  latitude: 41.79907,
  longitude: -87.58413,
  fullAddress: "5335 S Kimbark Ave Chicago IL 60615",
  address: "5335 S Kimbark Ave",
  city: "Chicago",
  state: "IL",
  zip: "60615",
};

const UPPER: NormalAddress = {
  latitude: 41.8,
  longitude: -87.6,
  fullAddress: "123 MAIN ST CHICAGO IL 60616",
  address: "123 MAIN ST",
  city: "CHICAGO",
  state: "IL",
  zip: "60616",
};

describe("Location entity", () => {
  describe("#fidByIdOrFullAddress", () => {
    // BUG-017: the old lowercase heuristic (`match(/[a-z]/g)`) sent any
    // string without a lowercase letter into the numeric-id branch,
    // producing WHERE id = Number("NEW REPORT HOOK, ...") = NaN, which
    // crashed the Aurora driver with 'param_1' is an invalid type (HTTP
    // 500). Mirrors Report #findByIdOrReportUrl; controller-level
    // regression coverage lives in LocationsController.test.ts #show.

    it("returns null for an uppercase-only string instead of a NaN id query (BUG-017 regression)", async () => {
      // Exact path from Bugsnag 6ad8e5dbdbd69358a880ff26: a Retool
      // webhook with an unsubstituted URL placeholder. Must take the
      // fullAddress branch (never Number() → NaN) and resolve null.
      expect(
        await Location.fidByIdOrFullAddress(
          "NEW REPORT HOOK, NEW LOCATION HOOK",
        ),
      ).toBeNull();
    });

    it("queries by numeric id when given a digit-only string", async () => {
      const created = await Location.createFromAddress(ADDRESS);

      const found = await Location.fidByIdOrFullAddress(`${created.id}`);
      expect(found).not.toBeNull();
      expect(found!.id).toEqual(created.id);
    });

    it("queries by fullAddress when given a mixed-case address", async () => {
      const created = await Location.createFromAddress(ADDRESS);

      const found = await Location.fidByIdOrFullAddress(ADDRESS.fullAddress);
      expect(found).not.toBeNull();
      expect(found!.id).toEqual(created.id);
    });

    it("finds a stored fully-uppercase address (BUG-017)", async () => {
      // Uppercase-only addresses like "123 MAIN ST" were misrouted into
      // the numeric-id branch by the old heuristic and 500ed; they must
      // resolve via the fullAddress branch.
      const created = await Location.createFromAddress(UPPER);

      const found = await Location.fidByIdOrFullAddress(UPPER.fullAddress);
      expect(found).not.toBeNull();
      expect(found!.id).toEqual(created.id);
    });

    it("normalizes + and %20 to spaces before matching fullAddress", async () => {
      const created = await Location.createFromAddress(ADDRESS);

      const plus = await Location.fidByIdOrFullAddress(
        ADDRESS.fullAddress.replace(/\s/g, "+"),
      );
      expect(plus!.id).toEqual(created.id);

      const pct = await Location.fidByIdOrFullAddress(
        ADDRESS.fullAddress.replace(/\s/g, "%20"),
      );
      expect(pct!.id).toEqual(created.id);
    });
  });
});