import * as http_mocks from "node-mocks-http";
import { DonationsController } from "./DonationsController";
import Stripe from 'stripe';

jest.mock('stripe');

const controller = new DonationsController();

describe("#create", () => {
  let mockStripeClient;

  beforeEach(() => {
    mockStripeClient = {
      checkout: {
        sessions: {
          create: jest.fn(async () => ({ id: "returned_id" }))
        }
      }
    };
    (Stripe as any).mockImplementation(() => mockStripeClient);

    process.env.STRIPE_SECRET_KEY = "STRIPE SECRET KEY";
    process.env.DONATION_PRODUCT_ID = "stripe_product_12345";
    process.env.CLIENT_APP_URL = "http://polls.pizza";
  });

  it("constructs a Stripe client using our secret key", async () => {
    process.env.STRIPE_SECRET_KEY = "STRIPE SECRET KEY"
    await controller.create(
      http_mocks.createRequest({ body: {} }),
      http_mocks.createResponse(),
      () => undefined
    );
    expect(Stripe).toHaveBeenCalledWith("STRIPE SECRET KEY", { apiVersion: "2020-08-27" });
  });

  it("creates a Stripe Checkout session", async() => {
    const body = await controller.create(
      http_mocks.createRequest({ body: { amountUsd: 10, referrer: "http://google.com" } }),
      http_mocks.createResponse(),
      () => undefined
    );
    expect(mockStripeClient.checkout.sessions.create).toHaveBeenCalledWith({
      payment_method_types: ['card'],
      line_items: [{
        description: 'About 1 pizza',
        price_data: {
          product: "stripe_product_12345",
          unit_amount: 1000,
          currency: 'usd',
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: 'http://polls.pizza/donate?success=true&amount_usd=10',
      cancel_url: 'http://polls.pizza/donate',
      metadata: {
        referrer: "http://google.com"
      }
    })

    expect(body.checkoutSessionId).toEqual("returned_id");
  });

  it("pluralizes pizzas", async () => {
    await controller.create(
      http_mocks.createRequest({ body: { amountUsd: 100, referrer: "http://google.com" } }),
      http_mocks.createResponse(),
      () => undefined
    );
    expect(mockStripeClient.checkout.sessions.create).toHaveBeenCalledWith({
      payment_method_types: ['card'],
      line_items: [{
        description: 'About 5 pizzas',
        price_data: {
          product: "stripe_product_12345",
          unit_amount: 10000,
          currency: 'usd',
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: 'http://polls.pizza/donate?success=true&amount_usd=100',
      cancel_url: 'http://polls.pizza/donate',
      metadata: {
        referrer: "http://google.com"
      }
    })
  });
});
