import { lambdaPost } from "../testLambdaHandler";
import dbHelper from "../dbHelper";
import { packPartnerSession } from "../../lib/partners";
import { User } from "../../entity/User";

jest.mock("../../lib/validator/geocode");
jest.mock("../../lib/mailgun");

const PARTNER_EMAIL = "nina@polls.pizza";

// The users table is the partner allowlist — seed a user for authed paths.
const seedPartnerUser = async (email = PARTNER_EMAIL) => {
  const user = new User();
  user.email = email;
  user.firstName = "Nina";
  user.organization = "Pizza to the Polls";
  user.admin = true;
  await user.save();
  return user;
};

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
    await seedPartnerUser();
    const token = await packPartnerSession(PARTNER_EMAIL);
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

  test("POST /partner/report webhook payload includes locationHasLiveReport + locationValidatedRecently", async () => {
    await seedPartnerUser();
    const token = await packPartnerSession(PARTNER_EMAIL);
    const response = await lambdaPost(
      "/partner/report",
      { address: "5335 S Kimbark Ave Chicago IL 60615", waitTime: "1-2 hours" },
      { Authorization: `Bearer ${token}` },
    );

    expect(response.statusCode).toBe(200);

    // Find the ZAP_NEW_REPORT (or ZAP_NEW_LOCATION) fetch call fired by the
    // createNewReport path.
    const zapCalls = (global.fetch as jest.Mock).mock.calls.filter(
      ([url]) =>
        url === process.env.ZAP_NEW_REPORT ||
        url === process.env.ZAP_NEW_LOCATION,
    );
    expect(zapCalls.length).toBeGreaterThan(0);

    const [, { body: zapBody }] = zapCalls[0];
    const payload = JSON.parse(zapBody);

    // Both flags present and boolean (never missing/undefined).
    expect(payload).toHaveProperty("locationHasLiveReport");
    expect(payload).toHaveProperty("locationValidatedRecently");
    expect(typeof payload.locationHasLiveReport).toBe("boolean");
    expect(typeof payload.locationValidatedRecently).toBe("boolean");

    // Fresh location + only report → no other live report.
    expect(payload.locationHasLiveReport).toBe(false);
    // Location was just validated by the partner flow → true.
    expect(payload.locationValidatedRecently).toBe(true);
  });

  test("POST /partner/report with a partner session but no waitTime is 422", async () => {
    await seedPartnerUser();
    const token = await packPartnerSession(PARTNER_EMAIL);
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
