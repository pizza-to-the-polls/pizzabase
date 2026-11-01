import { AppDataSource } from "../data-source";
import { Location } from "./Location";
import { Report } from "./Report";
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

  describe("#hasLiveReport", () => {
    // "Live" is the openReports definition: no order, no truck, not
    // skipped, created within REPORT_DECAY (4h). The incoming report itself
    // must not count when an excludeReportId is passed.
    it("is false when there are no open reports", async () => {
      const location = await Location.createFromAddress(ADDRESS);

      expect(await location.hasLiveReport()).toBe(false);
    });

    it("is true when an open report exists and no excludeId is given", async () => {
      const location = await Location.createFromAddress(ADDRESS);
      await Report.createNewReport(
        "555-555-5555",
        "http://twitter.com/live-1",
        ADDRESS,
      );

      expect(await location.hasLiveReport()).toBe(true);
    });

    it("is false when the only open report is the excluded one", async () => {
      const location = await Location.createFromAddress(ADDRESS);
      const [report] = await Report.createNewReport(
        "555-555-5555",
        "http://twitter.com/live-2",
        ADDRESS,
      );

      expect(await location.hasLiveReport(report.id)).toBe(false);
    });

    it("is true when another report exists besides the excluded one", async () => {
      const location = await Location.createFromAddress(ADDRESS);
      const [first] = await Report.createNewReport(
        "555-555-5555",
        "http://twitter.com/live-3",
        ADDRESS,
      );
      await Report.createNewReport(
        "555-555-5555",
        "http://twitter.com/live-4",
        ADDRESS,
      );

      expect(await location.hasLiveReport(first.id)).toBe(true);
    });

    it("is false when open reports exist only outside REPORT_DECAY", async () => {
      const location = await Location.createFromAddress(ADDRESS);
      const [report] = await Report.createNewReport(
        "555-555-5555",
        "http://twitter.com/live-5",
        ADDRESS,
      );

      // Backdate created_at past REPORT_DECAY (4h) via raw SQL because
      // created_at is a CreateDateColumn (same pattern as Report.test.ts).
      await AppDataSource.query(
        `UPDATE reports SET created_at = $1 WHERE id = $2`,
        [new Date(Date.now() - 5 * 60 * 60 * 1000), report.id],
      );

      expect(await location.hasLiveReport()).toBe(false);
    });
  });

  describe("#isValidatedRecently", () => {
    // "Approved" === validated (Location.validatedAt); the window is the
    // last 60 minutes, boundary exclusive.
    it("is false when validatedAt is null", async () => {
      const location = await Location.createFromAddress(ADDRESS);

      expect(location.isValidatedRecently()).toBe(false);
    });

    it("is true when validatedAt is 30 seconds ago", async () => {
      const location = await Location.createFromAddress(ADDRESS);
      location.validatedAt = new Date(Date.now() - 30 * 1000);
      await location.save();

      expect(location.isValidatedRecently()).toBe(true);
    });

    it("is false when validatedAt is exactly 60 minutes ago", async () => {
      const location = await Location.createFromAddress(ADDRESS);
      location.validatedAt = new Date(Date.now() - 60 * 60 * 1000);
      await location.save();

      expect(location.isValidatedRecently()).toBe(false);
    });

    it("is false when validatedAt is 61 minutes ago", async () => {
      const location = await Location.createFromAddress(ADDRESS);
      location.validatedAt = new Date(Date.now() - 61 * 60 * 1000);
      await location.save();

      expect(location.isValidatedRecently()).toBe(false);
    });
  });
});
