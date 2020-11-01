import { NextFunction, Request, Response } from "express";
import Stripe from "stripe";
import Bugsnag from "@bugsnag/js";

import { Donation } from "../entity/Donation";

export class DonationsController {
  async webhook(request: Request, response: Response, _next: NextFunction) {
    let event;

    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: "2020-08-27",
      });
      event = stripe.webhooks.constructEvent(
        request.body,
        request.headers["stripe-signature"],
        process.env.STRIPE_SECRET_WH
      );
    } catch (err) {
      response.status(400);
      return { errors: [`Webhook Error: ${err.message}`] };
    }

    switch (event.type) {
      case "charge.succeeded":
        await Donation.succeedCharge(event.data.object);
        break;
      case "charge.failed":
        await Donation.failCharge("failed", event.data.object);
        break;
      case "charge.refunded":
        await Donation.failCharge("refunded", event.data.object);
        break;
      case "charge.dispute.funds_withdrawn":
        await Donation.failCharge("dispute.funds_withdrawn", event.data.object);
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    return { success: true };
  }

  async create(request: Request, _response: Response, _next: NextFunction) {
    const { amountUsd, referrer } = request.body;

    const numberOfPizzas = Math.ceil(amountUsd / 20);
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: "2020-08-27",
      });

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            description: `About ${numberOfPizzas} ${
              numberOfPizzas === 1 ? "pizza" : "pizzas"
            }`,
            price_data: {
              product: process.env.STRIPE_PRODUCT_ID,
              unit_amount: amountUsd * 100,
              currency: "usd",
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          referrer,
        },
        success_url: `${process.env.STATIC_SITE}/donate/?success=true&amount_usd=${amountUsd}`,
        cancel_url: `${process.env.STATIC_SITE}/donate/`,
      });

      return { success: true, checkoutSessionId: session.id };
    } catch (e) {
      Bugsnag.notify(e);
      console.error(e);
      return { success: false, message: e.message };
    }
  }
}
