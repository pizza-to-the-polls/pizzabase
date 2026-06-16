import * as http_mocks from "node-mocks-http";
import Stripe from "stripe";
import Mailgun from "mailgun.js";

import { SessionController } from "./SessionController";
import { EMAIL_ERROR } from "../lib/validator/constants";

jest.mock("stripe");
jest.mock("mailgun.js");
jest.mock("../lib/jwt");

const controller = new SessionController();

describe("#create", () => {
  let mockStripeClient;
  let mockMailgunClient;
  let mockMailgunCreate;

  const goodEmail = "good@email.com";
  const customerId = "cust_123id";

  beforeEach(() => {
    mockStripeClient = {
      customers: {
        list: jest.fn(async ({ email }: { email: string }) => ({
          data: email === goodEmail ? [{ id: customerId }] : [],
        })),
      },
    };
    mockMailgunCreate = jest.fn(async () => ({
      status: 200,
      body: {
        id: "<20230516185545.72433b2597c5f82d@polls.pizza>",
        message: "Queued. Thank you.",
      },
    }));
    mockMailgunClient = {
      messages: { create: mockMailgunCreate },
    };

    (Stripe as any).mockImplementation(() => mockStripeClient);
    (Mailgun as any).mockImplementation(() => ({
      client: () => mockMailgunClient,
    }));

    process.env.STRIPE_SECRET_KEY = "STRIPE SECRET KEY";
    process.env.STRIPE_PRODUCT_ID = "stripe_product_12345";
    process.env.STATIC_SITE = "http://polls.pizza";
  });

  it("constructs a Stripe client using our secret key", async () => {
    process.env.STRIPE_SECRET_KEY = "STRIPE SECRET KEY";

    await controller.create(
      http_mocks.createRequest({ body: { email: goodEmail } }),
      http_mocks.createResponse(),
      () => undefined
    );
    expect(Stripe).toHaveBeenCalledWith("STRIPE SECRET KEY", {
      apiVersion: "2020-08-27",
      maxNetworkRetries: 6,
      timeout: 10_000,
    });
  });

  it("looks up a stripe customer id, generates, and emails a token", async () => {
    const body = await controller.create(
      http_mocks.createRequest({ body: { email: goodEmail } }),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(body.success).toEqual(true);
    expect(mockStripeClient.customers.list).toHaveBeenCalledWith({
      email: goodEmail,
    });
    expect(mockMailgunCreate).toHaveBeenCalledWith("polls.pizza", {
      from: "Crust Club @ Pizza to the Polls<crustclub@polls.pizza>",
      subject: "Log into Crust Club",
      template: "crust-club-log-in",
      "h:X-Mailgun-Variables": JSON.stringify({
        token: `${process.env.STATIC_SITE}/session/this-is-real-token/`,
      }),
      to: goodEmail,
    });
  });

  it("returns 422 if no email sent", async () => {
    const response = http_mocks.createResponse();
    const body = await controller.create(
      http_mocks.createRequest({
        method: "POST",
        body: { email: "invalid" },
      }),
      response,
      () => undefined
    );
    expect(body).toEqual({
      errors: {
        email: EMAIL_ERROR,
      },
    });
    expect(response.statusCode).toEqual(422);
  });

  it("triggers a non membership found email if no membership found", async () => {
    const email = "bad@email.com";
    const body = await controller.create(
      http_mocks.createRequest({ body: { email } }),
      http_mocks.createResponse(),
      () => undefined
    );

    expect(body.success).toEqual(true);
    expect(mockStripeClient.customers.list).toHaveBeenCalledWith({
      email,
    });
    expect(mockMailgunCreate).toHaveBeenCalledWith("polls.pizza", {
      from: "Crust Club @ Pizza to the Polls<crustclub@polls.pizza>",
      subject: "Couldn't Find Your Membership",
      template: "crust-club-no-membership",
      "h:X-Mailgun-Variables": JSON.stringify({ email }),
      to: email,
    });
  });
});

describe("#update", () => {
  let mockStripeClient;

  beforeEach(() => {
    mockStripeClient = {
      billingPortal: {
        sessions: {
          create: jest.fn(async () => ({
            url: "https://stripe.com/good-url-something",
          })),
        },
      },
    };
    (Stripe as any).mockImplementation(() => mockStripeClient);
  });

  it("raises 410 if JWT is invalid", async () => {
    const response = http_mocks.createResponse();
    const body = await controller.update(
      http_mocks.createRequest({
        method: "PUT",
        body: { token: "bad-token" },
      }),
      response,
      () => undefined
    );
    expect(body).toEqual({
      errors: {
        token: "Invalid URL - please try again",
      },
    });
    expect(response.statusCode).toEqual(410);
  });

  it("returns a redirect", async () => {
    const response = http_mocks.createResponse();

    const body = await controller.update(
      http_mocks.createRequest({
        method: "PUT",
        body: { token: "good-token" },
      }),
      response,
      () => undefined
    );

    expect(body).toEqual({
      success: true,
      redirect: "https://stripe.com/good-url-something",
    });
    expect(mockStripeClient.billingPortal.sessions.create).toHaveBeenCalledWith(
      {
        customer: "cust_1234",
        return_url: `${process.env.STATIC_SITE}/crustclub`,
      }
    );
    expect(response.statusCode).toEqual(200);
  });
});
