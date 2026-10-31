import { lambdaPost } from "../testLambdaHandler";
import dbHelper from "../dbHelper";
import { packPartnerSession, PARTNER_EMAILS } from "../../lib/partners";

jest.mock("../../lib/validator/geocode");
jest.mock("../../lib/mailgun");
jest.mock("../../lib/streetview");

describe("Partner reports API (via Lambda handler)", () => {
  afterEach(async () => {
    await dbHelper.cleanAll();
  });

  test("POST /partner/session returns generic success for any email", async () => {
    const response = await lambdaPost("/partner/session", {
      email: "someone@example.com",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual({ success: true });
  });

  test("POST /partner/session returns 422 without an email", async () => {
    const response = await lambdaPost("/partner/session", {});

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.errors?.email).toBeDefined();
  });

  test("POST /partner/report without a token is 401", async () => {
    const response = await lambdaPost("/partner/report", {
      address: "5335 S Kimbark Ave Chicago IL 60615",
      waitTime: "1-2 hours",
    });

    expect(response.statusCode).toBe(401);
  });

  test("POST /partner/report with a partner session creates a trusted report", async () => {
    const token = await packPartnerSession(PARTNER_EMAILS[0]);
    const response = await lambdaPost(
      "/partner/report",
      { address: "5335 S Kimbark Ave Chicago IL 60615", waitTime: "1-2 hours" },
      { Authorization: `Bearer ${token}` },
    );

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.address).toEqual("5335 S Kimbark Ave Chicago IL 60615");
    expect(body.hasTruck).toBe(false);
  });

  test("POST /partner/report with a partner session but no waitTime is 422", async () => {
    const token = await packPartnerSession(PARTNER_EMAILS[0]);
    const response = await lambdaPost(
      "/partner/report",
      { address: "5335 S Kimbark Ave Chicago IL 60615" },
      { Authorization: `Bearer ${token}` },
    );

    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.errors?.waitTime).toBeDefined();
  });
});
