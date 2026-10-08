import { AppDataSource } from "../data-source";
import { Report } from "./Report";
import { Location } from "./Location";
import { Order } from "./Order";
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

const PHONE = "+14255551234";

// A US number exercised in both its stored (web-form) and Twilio E.164
// forms. The E.164 form of the bare 10 digits is "+1" + the digits.
const BARE_US = "5038938626";
const E164_US = "+15038938626";

const backdate = async (report: Report, daysAgo: number) => {
  // Raw SQL because repository.update() deep-partial typing rejects Date for
  // CreateDateColumn fields (see TrucksController.test.ts for precedent).
  await AppDataSource.query(
    `UPDATE reports SET created_at = $1 WHERE id = $2`,
    [new Date(Number(new Date()) - daysAgo * 24 * 60 * 60 * 1000), report.id],
  );
};

describe("Report entity", () => {
  describe("#findRecentFulfilledByPhone", () => {
    afterEach(() => {
      delete process.env.MMS_MATCH_WINDOW_DAYS;
    });

    const makeReport = async (
      contactInfo: string,
      reportURL: string,
    ): Promise<Report> => {
      const [report] = await Report.createNewReport(
        contactInfo,
        reportURL,
        ADDRESS,
      );
      return report;
    };

    it("returns a report fulfilled by an order", async () => {
      const report = await makeReport(PHONE, "http://twitter.com/r/1");
      await Order.placeOrder({ quantity: 1, cost: 5 }, report.location);

      const found = await Report.findRecentFulfilledByPhone(PHONE);

      expect(found).not.toBeNull();
      expect(found!.id).toEqual(report.id);
      expect(found!.order).not.toBeNull();
      expect(found!.truck).toBeNull();
    });

    it("returns a report fulfilled by a truck assignment", async () => {
      const report = await makeReport(PHONE, "http://twitter.com/r/2");
      await report.location.assignTruck("admin", "truck-1");

      const found = await Report.findRecentFulfilledByPhone(PHONE);

      expect(found).not.toBeNull();
      expect(found!.id).toEqual(report.id);
      expect(found!.truck).not.toBeNull();
      expect(found!.order).toBeNull();
    });

    it("returns the newest fulfilled report when several match", async () => {
      const older = await makeReport(PHONE, "http://twitter.com/r/old");
      await Order.placeOrder({ quantity: 1, cost: 5 }, older.location);

      const newer = await makeReport(PHONE, "http://twitter.com/r/new");
      await Order.placeOrder({ quantity: 1, cost: 5 }, older.location);

      await backdate(older, 5);

      const found = await Report.findRecentFulfilledByPhone(PHONE);

      expect(found!.id).toEqual(newer.id);
    });

    it("returns null when no report matches the phone", async () => {
      await makeReport("+19999999999", "http://twitter.com/r/other");

      expect(await Report.findRecentFulfilledByPhone(PHONE)).toBeNull();
    });

    it("returns null when the matching report is unfulfilled", async () => {
      await makeReport(PHONE, "http://twitter.com/r/open");

      expect(await Report.findRecentFulfilledByPhone(PHONE)).toBeNull();
    });

    it("returns null when the fulfilled report is outside the default 30-day window", async () => {
      const report = await makeReport(PHONE, "http://twitter.com/r/ancient");
      await Order.placeOrder({ quantity: 1, cost: 5 }, report.location);
      await backdate(report, 40);

      expect(await Report.findRecentFulfilledByPhone(PHONE)).toBeNull();
    });

    it("honors a custom windowDays argument", async () => {
      const report = await makeReport(PHONE, "http://twitter.com/r/week");
      await Order.placeOrder({ quantity: 1, cost: 5 }, report.location);
      await backdate(report, 10);

      expect(await Report.findRecentFulfilledByPhone(PHONE, 30)).not.toBeNull();
      expect(await Report.findRecentFulfilledByPhone(PHONE, 5)).toBeNull();
    });

    it("honors the MMS_MATCH_WINDOW_DAYS env override", async () => {
      const report = await makeReport(PHONE, "http://twitter.com/r/env");
      await Order.placeOrder({ quantity: 1, cost: 5 }, report.location);
      await backdate(report, 2);

      process.env.MMS_MATCH_WINDOW_DAYS = "1";
      expect(await Report.findRecentFulfilledByPhone(PHONE)).toBeNull();

      process.env.MMS_MATCH_WINDOW_DAYS = "7";
      expect(await Report.findRecentFulfilledByPhone(PHONE)).not.toBeNull();
    });

    it("normalizes formatting from the input phone before matching", async () => {
      const report = await makeReport(PHONE, "http://twitter.com/r/norm");
      await Order.placeOrder({ quantity: 1, cost: 5 }, report.location);

      const found =
        await Report.findRecentFulfilledByPhone("+1 (425) 555-1234");

      expect(found).not.toBeNull();
      expect(found!.id).toEqual(report.id);
    });

    it("matches a report stored as bare 10 digits when queried with the +1 E.164 form", async () => {
      const report = await makeReport(BARE_US, "http://twitter.com/r/10dig");
      await Order.placeOrder({ quantity: 1, cost: 5 }, report.location);

      const found = await Report.findRecentFulfilledByPhone(E164_US);

      expect(found).not.toBeNull();
      expect(found!.id).toEqual(report.id);
    });

    it("matches a report stored as +1 E.164 when queried with bare 10 digits", async () => {
      const report = await makeReport(E164_US, "http://twitter.com/r/e164");
      await Order.placeOrder({ quantity: 1, cost: 5 }, report.location);

      const found = await Report.findRecentFulfilledByPhone(BARE_US);

      expect(found).not.toBeNull();
      expect(found!.id).toEqual(report.id);
    });

    it("converges all common US formatting variants on the same report", async () => {
      const report = await makeReport(BARE_US, "http://twitter.com/r/fmt");
      await Order.placeOrder({ quantity: 1, cost: 5 }, report.location);

      for (const q of [
        E164_US,
        "503-893-8626",
        "(503) 893-8626",
        BARE_US,
        "15038938626",
      ]) {
        const found = await Report.findRecentFulfilledByPhone(q);
        expect(found).not.toBeNull();
        expect(found!.id).toEqual(report.id);
      }
    });

    it("converges on the truck branch with variant forms too", async () => {
      const report = await makeReport(BARE_US, "http://twitter.com/r/truck");
      await report.location.assignTruck("admin", "truck-1");

      const found = await Report.findRecentFulfilledByPhone(E164_US);

      expect(found).not.toBeNull();
      expect(found!.id).toEqual(report.id);
      expect(found!.truck).not.toBeNull();
      expect(found!.order).toBeNull();
    });

    it("non-US number still exact-matches itself and does not invent variants", async () => {
      const ukPhone = "+442071234567";
      const report = await makeReport(ukPhone, "http://twitter.com/r/uk");
      await Order.placeOrder({ quantity: 1, cost: 5 }, report.location);

      const found = await Report.findRecentFulfilledByPhone(ukPhone);
      expect(found).not.toBeNull();
      expect(found!.id).toEqual(report.id);

      // The bare digits-with-country-code form must NOT match — no
      // variants are invented for non-US numbers.
      expect(
        await Report.findRecentFulfilledByPhone("442071234567"),
      ).toBeNull();
    });

    it("returns the report with its eager location loaded", async () => {
      const report = await makeReport(PHONE, "http://twitter.com/r/loc");
      await Order.placeOrder({ quantity: 1, cost: 5 }, report.location);

      const found = await Report.findRecentFulfilledByPhone(PHONE);

      expect(found).not.toBeNull();
      expect(found!.location).toBeInstanceOf(Location);
      expect(found!.location.id).toEqual(report.location.id);
      expect(found!.location.fullAddress).toEqual(ADDRESS.fullAddress);
    });
  });
});
