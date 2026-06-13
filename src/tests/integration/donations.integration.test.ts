import { lambdaPost } from "../testLambdaHandler";
import dbHelper from "../dbHelper";

jest.mock("stripe");

describe("Donations API (via Lambda handler)", () => {
  beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    process.env.STRIPE_PRODUCT_ID = "price_test";
    process.env.STATIC_SITE = "http://localhost:3333";
    process.env.STRIPE_SECRET_WH = "whsec_test_secret";
  });

  afterEach(async () => {
    await dbHelper.cleanAll();
  });

  test("POST /webhook rejects invalid signature", async () => {
    const response = await lambdaPost(
      "/webhook",
      { type: "charge.succeeded" },
      { "stripe-signature": "fake-sig" }
    );

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.errors).toBeDefined();
  });
});
