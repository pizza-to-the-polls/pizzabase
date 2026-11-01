import { lambdaGet, lambdaPost } from "../testLambdaHandler";
import dbHelper from "../dbHelper";
import { packPartnerSession } from "../../lib/partners";
import { Report } from "../../entity/Report";
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

describe("trusted_by read paths (via Lambda handler)", () => {
  afterEach(async () => {
    await dbHelper.cleanAll();
  });

  test("GET /locations/:id carries trustedBy on its reports when authorized", async () => {
    // The staging bug this pins: report.trustedBy was persisted (FK set) but
    // serialized null on read paths — the relation wasn't eager, so bare
    // loads (Retool location endpoint) never populated it. Only the
    // submit-time in-memory object had it, which is why the zap banner
    // worked while the location payload showed null.
    const user = new User();
    user.email = "nina@polls.pizza";
    user.firstName = "Nina";
    user.organization = "Pizza to the Polls";
    user.admin = true;
    await user.save();

    const [report] = await Report.createNewReport(
      "555-234-2345",
      "http://twitter.com/test/status/555",
      {
        latitude: 41.79907,
        longitude: -87.58413,
        fullAddress: "5335 S Kimbark Ave Chicago IL 60615",
        address: "5335 S Kimbark Ave",
        city: "Chicago",
        state: "IL",
        zip: "60615",
      },
    );
    report.trustedBy = user;
    await report.save();

    const response = await lambdaGet(`/locations/${report.location.id}`, {
      Authorization: `Basic ${process.env.GOOD_API_KEY}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const row = (body.reports || []).find((r: any) => r.id === report.id);
    expect(row).toBeTruthy();
    expect(row.trustedBy).toBeTruthy();
    expect(row.trustedBy.email).toEqual("nina@polls.pizza");
    expect(row.trustedBy.organization).toEqual("Pizza to the Polls");
  });
});
