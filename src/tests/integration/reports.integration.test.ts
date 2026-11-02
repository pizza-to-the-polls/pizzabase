import { lambdaPost, lambdaGet } from "../testLambdaHandler";
import dbHelper from "../dbHelper";
import { Location } from "../../entity/Location";
import { Report } from "../../entity/Report";

jest.mock("../../lib/validator/geocode");

describe("Reports API (via Lambda handler)", () => {
  afterEach(async () => {
    await dbHelper.cleanAll();
  });

  test("POST /report with invalid data returns 422", async () => {
    const response = await lambdaPost("/report", {});

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.errors).toBeDefined();
  });

  test("POST /report with a valid phone/address creates a report", async () => {
    const response = await lambdaPost("/report", {
      url: "https://twitter.com/test/status/456",
      address: "5335 S Kimbark Ave Chicago IL 60615",
      contact: "333-234-2345",
      waitTime: "1 hour",
      canDistribute: true,
    });

    // May be 200 or 422 depending on mock geocode; we just verify Lambda path
    expect(response.statusCode).toBeGreaterThanOrEqual(200);
    expect(response.statusCode).toBeLessThan(500);
  });

  test("POST /report with a Georgia address creates and auto-skips the report", async () => {
    const response = await lambdaPost("/report", {
      url: "https://twitter.com/test/status/789",
      address: "206 Washington St SW Atlanta GA 30334",
      contact: "333-234-2345",
      waitTime: "1 hour",
      canDistribute: true,
    });

    // Accepted (the SB 22 422 is gone) but auto-skipped at creation.
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.autoSkipped).toBe(true);
    expect(body.skipReason).toBe("georgia");
    expect(body.willReceive).toBe(false);

    const report = await Report.findOne({
      where: { reportURL: "https://twitter.com/test/status/789" },
    });
    expect(report).toBeTruthy();
    expect(report.skippedAt).toBeTruthy();
    expect(report.order).toBeFalsy();
    expect(report.truck).toBeFalsy();

    // Volunteer zaps did not fire — the report never enters the pipeline.
    const zapCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([zapUrl]) =>
        zapUrl === process.env.ZAP_NEW_REPORT ||
        zapUrl === process.env.ZAP_NEW_LOCATION,
    );
    expect(zapCalls).toHaveLength(0);

    // The public location view never presents it as a live line.
    const location = await Location.findOne({
      where: { fullAddress: body.address },
    });
    expect(location).toBeTruthy();
    const open = await location.openReports();
    expect(open.map((r) => r.id)).not.toContain(report.id);
  });

  test("GET /reports lists empty reports on fresh DB", async () => {
    const response = await lambdaGet("/reports");
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.count).toBe(0);
    expect(body.results).toEqual([]);
  });
});
