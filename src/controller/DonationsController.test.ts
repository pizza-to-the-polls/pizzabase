import * as http_mocks from "node-mocks-http";
import Stripe from "stripe";

import { DonationsController } from "./DonationsController";
import { Donation } from "../entity/Donation";

jest.mock("stripe");

const controller = new DonationsController();

describe("#create", () => {
  let mockStripeClient;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    mockStripeClient = {
      checkout: {
        sessions: {
          create: jest.fn(async () => ({ id: "returned_id" })),
        },
      },
      prices: {
        list: jest.fn(async () => ({
          data: [
            {
              unit_amount: 20_00,
              id: "price_blahblah",
              currency: "usd",
              recurring: { interval: "month" },
            },
            {
              unit_amount: 10_00,
              id: "price_other",
              currency: "usd",
              recurring: { interval: "month" },
            },
          ],
        })),
      },
    };
    (Stripe as any).mockImplementation(() => mockStripeClient);

    process.env.STRIPE_SECRET_KEY = "STRIPE SECRET KEY";
    process.env.STRIPE_PRODUCT_ID = "stripe_product_12345";
    process.env.STATIC_SITE = "http://polls.pizza";
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("constructs a Stripe client using our secret key", async () => {
    process.env.STRIPE_SECRET_KEY = "STRIPE SECRET KEY";
    await controller.create(
      http_mocks.createRequest({ body: {} }),
      http_mocks.createResponse(),
      () => undefined,
    );
    expect(Stripe).toHaveBeenCalledWith("STRIPE SECRET KEY", {
      maxNetworkRetries: 6,
      timeout: 5_000,
    });
  });

  it("creates a Stripe Checkout session", async () => {
    const body = await controller.create(
      http_mocks.createRequest({
        body: {
          amountUsd: 10,
          referrer: "http://google.com",
          giftName: "bob smith",
          giftEmail: "bob@bob.com",
        },
      }),
      http_mocks.createResponse(),
      () => undefined,
    );
    expect(mockStripeClient.checkout.sessions.create).toHaveBeenCalledWith({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            product: "stripe_product_12345",
            unit_amount: 1000,
            currency: "usd",
          },
          quantity: 1,
        },
      ],
      submit_type: "donate",
      mode: "payment",
      success_url:
        "http://polls.pizza/gift/?success=true&amount_usd=10&gift_name=bob smith",
      cancel_url: "http://polls.pizza/gift/",
      payment_intent_data: {
        metadata: {
          referrer: "http://google.com",
          giftName: "bob smith",
          giftEmail: "bob@bob.com",
          url: undefined,
        },
      },
    });

    expect(body.checkoutSessionId).toEqual("returned_id");
  });

  it("pluralizes pizzas", async () => {
    await controller.create(
      http_mocks.createRequest({
        body: { amountUsd: 100, url: "http://google.com" },
      }),
      http_mocks.createResponse(),
      () => undefined,
    );
    expect(mockStripeClient.checkout.sessions.create).toHaveBeenCalledWith({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            product: "stripe_product_12345",
            unit_amount: 10000,
            currency: "usd",
          },
          quantity: 1,
        },
      ],
      submit_type: "donate",
      mode: "payment",
      success_url: "http://polls.pizza/donate/?success=true&amount_usd=100",
      cancel_url: "http://polls.pizza/donate/",
      payment_intent_data: {
        metadata: {
          url: "http://google.com",
          referrer: undefined,
        },
      },
    });
  });

  it("creates a subcription", async () => {
    await controller.create(
      http_mocks.createRequest({
        body: {
          type: "subscription",
          amountUsd: 20,
          url: "http://polls.pizza/donate",
        },
      }),
      http_mocks.createResponse(),
      () => undefined,
    );

    expect(mockStripeClient.prices.list).toHaveBeenCalledWith({
      type: "recurring",
      active: true,
      currency: "usd",
      lookup_keys: [
        "crustclub-monthly5usd",
        "crustclub-monthly10usd",
        "crustclub-monthly20usd",
        "crustclub-monthly50usd",
        "crustclub-monthly100usd",
      ],
    });

    expect(mockStripeClient.checkout.sessions.create).toHaveBeenCalledWith({
      payment_method_types: ["card"],
      shipping_address_collection: {
        allowed_countries: ["US"],
      },
      line_items: [
        {
          price: "price_blahblah",
          quantity: 1,
        },
      ],

      mode: "subscription",
      success_url: "http://polls.pizza/crustclub/?success=true&amount_usd=20",
      cancel_url: "http://polls.pizza/donate?amount_usd=20&type=subscription",
      subscription_data: {
        metadata: {
          url: "http://polls.pizza/donate",
          referrer: undefined,
        },
      },
    });
  });

  it("never matches a yearly price for a monthly subscription", async () => {
    // Mirrors production: a $100/year price appears first (newest) with the
    // same unit_amount as the $100/month price, which sits further down.
    // The keyed lookup returns both; the yearly one must never win.
    mockStripeClient.prices.list.mockResolvedValueOnce({
      data: [
        {
          unit_amount: 100_00,
          id: "price_yearly_collision",
          currency: "usd",
          recurring: { interval: "year" },
        },
        {
          unit_amount: 100_00,
          id: "price_monthly_correct",
          currency: "usd",
          recurring: { interval: "month" },
        },
      ],
    });

    await controller.create(
      http_mocks.createRequest({
        body: {
          type: "subscription",
          amountUsd: 100,
          url: "http://polls.pizza/donate",
        },
      }),
      http_mocks.createResponse(),
      () => undefined,
    );

    expect(mockStripeClient.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: "price_monthly_correct", quantity: 1 }],
      }),
    );
  });

  it("falls back to attribute matching when lookup keys are missing", async () => {
    // Mirrors production history: Crust Club prices sat past the 10th
    // position of the default page, so the fallback must request the full
    // (limit 100) monthly-filtered list, not the default 10-price page.
    const fillerPrices = Array.from({ length: 11 }, (_, i) => ({
      unit_amount: 1_00 + i,
      id: `price_filler_${i}`,
      currency: "usd",
      recurring: { interval: "month" },
    }));
    mockStripeClient.prices.list
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [
          ...fillerPrices,
          {
            unit_amount: 20_00,
            id: "price_crustclub_monthly_20",
            currency: "usd",
            recurring: { interval: "month" },
          },
        ],
      });

    await controller.create(
      http_mocks.createRequest({
        body: {
          type: "subscription",
          amountUsd: 20,
          url: "http://polls.pizza/donate",
        },
      }),
      http_mocks.createResponse(),
      () => undefined,
    );

    expect(mockStripeClient.prices.list).toHaveBeenNthCalledWith(2, {
      type: "recurring",
      active: true,
      currency: "usd",
      recurring: { interval: "month" },
      limit: 100,
    });

    expect(mockStripeClient.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: "price_crustclub_monthly_20", quantity: 1 }],
      }),
    );
  });

  it("returns the requested amount when no monthly price matches", async () => {
    // Neither the keyed lookup nor the attribute fallback finds a match.
    mockStripeClient.prices.list
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [
          {
            unit_amount: 20_00,
            id: "price_yearly_only",
            currency: "usd",
            recurring: { interval: "year" },
          },
        ],
      });

    const body = await controller.create(
      http_mocks.createRequest({
        body: {
          type: "subscription",
          amountUsd: 20,
          url: "http://polls.pizza/donate",
        },
      }),
      http_mocks.createResponse(),
      () => undefined,
    );

    expect(body).toEqual({
      success: false,
      message: "No active monthly price for $20",
    });
    expect(mockStripeClient.checkout.sessions.create).not.toHaveBeenCalled();

    // FEAT-004: even this failure path logs a checkout outcome with type.
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "donation_checkout",
        outcome: "failed",
        type: "subscription",
      }),
    );
  });

  it("logs donation_checkout session_created on success", async () => {
    await controller.create(
      http_mocks.createRequest({ body: { amountUsd: 10, type: "donation" } }),
      http_mocks.createResponse(),
      () => undefined,
    );

    // FEAT-004: structured checkout log — no body contents (amount is fine,
    // but never giftName/giftEmail/referrer).
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "donation_checkout",
        outcome: "session_created",
        type: "donation",
      }),
    );

    const loggedLine = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((arg: string) => arg?.includes("donation_checkout"));
    expect(loggedLine).not.toContain("giftName");
    expect(loggedLine).not.toContain("bob");
  });

  it("logs donation_checkout session_created for subscriptions", async () => {
    await controller.create(
      http_mocks.createRequest({
        body: { amountUsd: 20, type: "subscription" },
      }),
      http_mocks.createResponse(),
      () => undefined,
    );

    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "donation_checkout",
        outcome: "session_created",
        type: "subscription",
      }),
    );
  });

  it("logs failed checkout without the raw error message", async () => {
    mockStripeClient.checkout.sessions.create.mockRejectedValueOnce(
      new Error("Stripe API error: payload contains bob smith"),
    );

    const body = await controller.create(
      http_mocks.createRequest({
        body: { amountUsd: 10, type: "donation" },
      }),
      http_mocks.createResponse(),
      () => undefined,
    );

    expect(body.success).toEqual(false);

    // FEAT-004: failed checkouts log the outcome — never the raw error
    // message, which may embed the checkout payload.
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "donation_checkout",
        outcome: "failed",
        type: "donation",
      }),
    );

    const loggedLine = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((arg: string) => arg?.includes("donation_checkout"));
    expect(loggedLine).not.toContain("Stripe API error");
    expect(loggedLine).not.toContain("bob smith");
  });
});

describe("#webhook", () => {
  let mockStripeClient;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    mockStripeClient = {
      webhooks: {
        constructEvent: jest.fn((body) => body),
      },
    };
    (Stripe as any).mockImplementation(() => mockStripeClient);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
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
        body,
        headers: { "stripe-signature": STRIPE_SIG },
      }),
      http_mocks.createResponse(),
      () => undefined,
    );
    expect(Stripe).toHaveBeenCalledWith("STRIPE SECRET KEY", {
      maxNetworkRetries: 3,
      timeout: 10_000,
    });
    expect(mockStripeClient.webhooks.constructEvent).toHaveBeenCalledWith(
      body,
      STRIPE_SIG,
      process.env.STRIPE_SECRET_WH,
    );
  });

  it("counts a successful charge", async () => {
    const id = "stripe_tokengoeshere";
    const amount = 500_00;
    const email = "sds@example.net";
    const postalCode = "12345";
    const referrer = "good-friends";
    const giftName = "for bob";
    const giftEmail = "for bob";
    const url = "google.com";
    const body = {
      type: "charge.succeeded",
      data: {
        object: {
          id,
          amount,
          billing_details: { email, address: { postal_code: postalCode } },
          metadata: { referrer, giftName, giftEmail, url },
        },
      },
    };
    await controller.webhook(
      http_mocks.createRequest({
        body,
        headers: { "stripe-signature": "yip" },
      }),
      http_mocks.createResponse(),
      () => undefined,
    );
    const donation = await Donation.findOne({ where: { email } });
    expect(donation.stripeId).toEqual(id);
    expect(donation.amountGross).toEqual(amount / 100);
    expect(donation.amount).toEqual(485.2);
    expect(donation.email).toEqual(email);
    expect(donation.postalCode).toEqual(postalCode);
    expect(donation.referrer).toEqual(referrer);
    expect(donation.gift).toEqual(`${giftName} <${giftEmail}>`);
    expect(donation.url).toEqual(url);

    // FEAT-004: handled webhook types log the event type + outcome — never
    // the payload (email/postalCode must not appear).
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "stripe_webhook",
        type: "charge.succeeded",
        outcome: "handled",
      }),
    );
    const loggedLine = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((arg: string) => arg?.includes("stripe_webhook"));
    expect(loggedLine).not.toContain(email);
    expect(loggedLine).not.toContain(postalCode);
  });

  it("handles a sparse charge with missing optional fields", async () => {
    const id = "stripe_sparsecharge";
    const amount = 200_00;
    const email = "minimal@example.net";
    const body = {
      type: "charge.succeeded",
      data: {
        object: {
          id,
          amount,
          billing_details: { email, address: {} },
          metadata: {},
        },
      },
    };
    await controller.webhook(
      http_mocks.createRequest({
        body,
        headers: { "stripe-signature": "yip" },
      }),
      http_mocks.createResponse(),
      () => undefined,
    );
    const donation = await Donation.findOne({ where: { email } });
    expect(donation).toBeTruthy();
    expect(donation.stripeId).toEqual(id);
    expect(donation.postalCode).toBeNull();
    expect(donation.referrer).toBeNull();
    expect(donation.gift).toBeNull();
    expect(donation.url).toEqual("https://polls.pizza");
  });

  it("handles a charge with null billing_details", async () => {
    const id = "stripe_nullbilling";
    const amount = 100_00;
    const body = {
      type: "charge.succeeded",
      data: {
        object: {
          id,
          amount,
          billing_details: null,
          metadata: null,
        },
      },
    };
    await controller.webhook(
      http_mocks.createRequest({
        body,
        headers: { "stripe-signature": "yip" },
      }),
      http_mocks.createResponse(),
      () => undefined,
    );
    const donation = await Donation.findOne({ where: { email: "" } });
    expect(donation).toBeTruthy();
    expect(donation.stripeId).toEqual(id);
    expect(donation.email).toEqual("");
    expect(donation.postalCode).toBeNull();
    expect(donation.referrer).toBeNull();
    expect(donation.gift).toBeNull();
    expect(donation.url).toEqual("https://polls.pizza");
  });

  it("handles a charge with no receipt_email (uses empty string fallback)", async () => {
    const id = "stripe_noemail";
    const amount = 300_00;
    const body = {
      type: "charge.succeeded",
      data: {
        object: {
          id,
          amount,
          billing_details: {},
          metadata: {},
        },
      },
    };
    await controller.webhook(
      http_mocks.createRequest({
        body,
        headers: { "stripe-signature": "yip" },
      }),
      http_mocks.createResponse(),
      () => undefined,
    );
    const donation = await Donation.findOne({ where: { email: "" } });
    expect(donation).toBeTruthy();
    expect(donation.email).toEqual("");
    expect(donation.stripeId).toEqual(id);
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
        body,
        headers: { "stripe-signature": "yip" },
      }),
      http_mocks.createResponse(),
      () => undefined,
    );
    await donation.reload();
    expect(donation.cancelNote).toEqual("failed");
    expect(donation.cancelledAt).toBeTruthy();

    // FEAT-004
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "stripe_webhook",
        type: "charge.failed",
        outcome: "handled",
      }),
    );
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
        body,
        headers: { "stripe-signature": "yip" },
      }),
      http_mocks.createResponse(),
      () => undefined,
    );
    await donation.reload();
    expect(donation.cancelNote).toEqual("refunded");
    expect(donation.cancelledAt).toBeTruthy();

    // FEAT-004
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "stripe_webhook",
        type: "charge.refunded",
        outcome: "handled",
      }),
    );
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
        body,
        headers: { "stripe-signature": "yip" },
      }),
      http_mocks.createResponse(),
      () => undefined,
    );
    await donation.reload();
    expect(donation.cancelNote).toEqual("dispute.funds_withdrawn");
    expect(donation.cancelledAt).toBeTruthy();

    // FEAT-004
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "stripe_webhook",
        type: "charge.dispute.funds_withdrawn",
        outcome: "handled",
      }),
    );
  });

  it("logs unhandled webhook event types", async () => {
    const body = {
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_123" } },
    };

    const response = await controller.webhook(
      http_mocks.createRequest({
        body,
        headers: { "stripe-signature": "yip" },
      }),
      http_mocks.createResponse(),
      () => undefined,
    );

    expect(response).toEqual({ success: true });

    // FEAT-004: default branch logs outcome "unhandled" with the event type.
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "stripe_webhook",
        type: "payment_intent.succeeded",
        outcome: "unhandled",
      }),
    );
    // The payload must never be logged.
    const loggedLine = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((arg: string) => arg?.includes("stripe_webhook"));
    expect(loggedLine).not.toContain("pi_123");
  });

  it("logs signature_error when webhook verification fails", async () => {
    mockStripeClient.webhooks.constructEvent.mockImplementation(() => {
      throw new Error("Stripe signature verification failed");
    });

    const response = http_mocks.createResponse();
    const body = await controller.webhook(
      http_mocks.createRequest({
        body: { type: "charge.succeeded", data: { object: {} } },
        headers: { "stripe-signature": "bad-sig" },
      }),
      response,
      () => undefined,
    );

    expect(response.statusCode).toEqual(400);
    expect(body).toEqual({
      errors: ["Webhook Error: Stripe signature verification failed"],
    });

    // FEAT-004: signature failures log a dedicated outcome — no event type
    // (it never parsed) and no error message in the structured line.
    expect(consoleLogSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: "stripe_webhook",
        outcome: "signature_error",
      }),
    );
    const loggedLine = consoleLogSpy.mock.calls
      .map((call) => call[0])
      .find((arg: string) => arg?.includes("stripe_webhook"));
    expect(loggedLine).not.toContain("Stripe signature verification failed");
    expect(loggedLine).not.toContain("charge.succeeded");
  });
});
