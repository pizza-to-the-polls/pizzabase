import * as http_mocks from "node-mocks-http";
import Stripe from "stripe";

import { DonationsController } from "./DonationsController";
import { Donation } from "../entity/Donation";

jest.mock("stripe");

const controller = new DonationsController();

describe("#create", () => {
  let mockStripeClient;

  beforeEach(() => {
    mockStripeClient = {
      checkout: {
        sessions: {
          create: jest.fn(async () => ({ id: "returned_id" })),
        },
      },
    };
    (Stripe as any).mockImplementation(() => mockStripeClient);

    process.env.STRIPE_SECRET_KEY = "STRIPE SECRET KEY";
    process.env.STRIPE_PRODUCT_ID = "stripe_product_12345";
    process.env.STATIC_SITE = "http://polls.pizza";
  });

  it("constructs a Stripe client using our secret key", async () => {
    process.env.STRIPE_SECRET_KEY = "STRIPE SECRET KEY";
    await controller.create(
      http_mocks.createRequest({ body: {} }),
      http_mocks.createResponse(),
      () => undefined
    );
    expect(Stripe).toHaveBeenCalledWith("STRIPE SECRET KEY", {
      apiVersion: "2020-08-27",
    });
  });

  it("creates a Stripe Checkout session", async () => {
    const body = await controller.create(
      http_mocks.createRequest({
        body: { amountUsd: 10, referrer: "http://google.com" },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    expect(mockStripeClient.checkout.sessions.create).toHaveBeenCalledWith({
      payment_method_types: ["card"],
      line_items: [
        {
          description: "About 1 pizza",
          price_data: {
            product: "stripe_product_12345",
            unit_amount: 1000,
            currency: "usd",
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: "http://polls.pizza/donate?success=true&amount_usd=10",
      cancel_url: "http://polls.pizza/donate",
      metadata: {
        referrer: "http://google.com",
      },
    });

    expect(body.checkoutSessionId).toEqual("returned_id");
  });

  it("pluralizes pizzas", async () => {
    await controller.create(
      http_mocks.createRequest({
        body: { amountUsd: 100, referrer: "http://google.com" },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    expect(mockStripeClient.checkout.sessions.create).toHaveBeenCalledWith({
      payment_method_types: ["card"],
      line_items: [
        {
          description: "About 5 pizzas",
          price_data: {
            product: "stripe_product_12345",
            unit_amount: 10000,
            currency: "usd",
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: "http://polls.pizza/donate?success=true&amount_usd=100",
      cancel_url: "http://polls.pizza/donate",
      metadata: {
        referrer: "http://google.com",
      },
    });
  });
});

describe("#webhook", () => {
  let mockStripeClient;

  beforeEach(() => {
    mockStripeClient = {
      webhooks: {
        constructEvent: jest.fn((blob) => JSON.parse(blob)),
      },
    };
    (Stripe as any).mockImplementation(() => mockStripeClient);
  });

  it("constructs a Stripe client using our secret key and valdiates the webhook", async () => {
    process.env.STRIPE_SECRET_KEY = "STRIPE SECRET KEY";
    process.env.STRIPE_SECRET_WH = "STRIPE WEBHOOK SECRET";

    const STRIPE_SIG = "this-is-real-webhook";
    const id = "stripe_tokengoeshere";
    const amount = 500_00;
    const email = "sds@example.net";
    const postalCode = "12345";
    const referrer = "good-friends";
    const body = {
      type: "charge.succeeded",
      data: {
        object: {
          id,
          amount,
          billing_details: { email, address: { postal_code: postalCode } },
          metadata: { referrer },
        },
      },
    };

    await controller.webhook(
      http_mocks.createRequest({
        rawBody: JSON.stringify(body),
        headers: { "stripe-signature": STRIPE_SIG },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    expect(Stripe).toHaveBeenCalledWith("STRIPE SECRET KEY", {
      apiVersion: "2020-08-27",
    });
    expect(mockStripeClient.webhooks.constructEvent).toHaveBeenCalledWith(
      JSON.stringify(body),
      STRIPE_SIG,
      process.env.STRIPE_SECRET_WH
    );
  });

  it("counts a successful charge", async () => {
    const id = "stripe_tokengoeshere";
    const amount = 500_00;
    const email = "sds@example.net";
    const postalCode = "12345";
    const referrer = "good-friends";
    const body = {
      type: "charge.succeeded",
      data: {
        object: {
          id,
          amount,
          billing_details: { email, address: { postal_code: postalCode } },
          metadata: { referrer },
        },
      },
    };
    await controller.webhook(
      http_mocks.createRequest({
        rawBody: JSON.stringify(body),
        headers: { "stripe-signature": "yip" },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    const donation = await Donation.findOne({ where: { email } });
    expect(donation.stripeId).toEqual(id);
    expect(donation.amountGross).toEqual(amount / 100);
    expect(donation.amount).toEqual(485.2);
    expect(donation.email).toEqual(email);
    expect(donation.postalCode).toEqual(postalCode);
    expect(donation.referrer).toEqual(referrer);
  });

  it("deducts a failed charge", async () => {
    const id = "stripe_tokengoeshere";

    const donation = new Donation();
    donation.stripeId = id;
    donation.email = "brap@example.com";
    donation.amount = 500;
    donation.amountGross = 500;
    await donation.save();

    const body = {
      type: "charge.failed",
      data: {
        object: {
          id,
        },
      },
    };
    await controller.webhook(
      http_mocks.createRequest({
        rawBody: JSON.stringify(body),
        headers: { "stripe-signature": "yip" },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    await donation.reload();
    expect(donation.cancelNote).toEqual("failed");
    expect(donation.cancelledAt).toBeTruthy();
  });

  it("deducts a refunded", async () => {
    const id = "stripe_tokengoeshere";

    const donation = new Donation();
    donation.stripeId = id;
    donation.email = "brap@example.com";
    donation.amount = 500;
    donation.amountGross = 500;
    await donation.save();

    const body = {
      type: "charge.refunded",
      data: {
        object: {
          id,
        },
      },
    };
    await controller.webhook(
      http_mocks.createRequest({
        rawBody: JSON.stringify(body),
        headers: { "stripe-signature": "yip" },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    await donation.reload();
    expect(donation.cancelNote).toEqual("refunded");
    expect(donation.cancelledAt).toBeTruthy();
  });

  it("deducts a dispute.funds_withdrawn", async () => {
    const id = "stripe_tokengoeshere";

    const donation = new Donation();
    donation.stripeId = id;
    donation.email = "brap@example.com";
    donation.amount = 500;
    donation.amountGross = 500;
    await donation.save();

    const body = {
      type: "charge.dispute.funds_withdrawn",
      data: {
        object: {
          id,
        },
      },
    };
    await controller.webhook(
      http_mocks.createRequest({
        rawBody: JSON.stringify(body),
        headers: { "stripe-signature": "yip" },
      }),
      http_mocks.createResponse(),
      () => undefined
    );
    await donation.reload();
    expect(donation.cancelNote).toEqual("dispute.funds_withdrawn");
    expect(donation.cancelledAt).toBeTruthy();
  });
});
