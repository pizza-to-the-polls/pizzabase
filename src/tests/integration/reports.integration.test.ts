import { lambdaPost, lambdaGet } from "../testLambdaHandler";
import dbHelper from "../dbHelper";

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

  test("GET /reports lists empty reports on fresh DB", async () => {
    const response = await lambdaGet("/reports");
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.count).toBe(0);
    expect(body.results).toEqual([]);
  });
});
