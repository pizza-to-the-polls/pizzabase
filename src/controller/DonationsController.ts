import { NextFunction, Request, Response } from "express";
import * as Stripe from "stripe";

import { Donation } from "../entity/Donation";

const stripe = Stripe(process.env.STRIPE_KEY);

export class DonationsController {
  async webhook(request: Request, response: Response, _next: NextFunction) {
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        JSON.stringify(request.body),
        request.headers["stripe-signature"],
        process.env.STRIPE_WH_SECRET
      );
    } catch (err) {
      response.status(400);
      return `Webhook Error: ${err.message}`;
    }

    const { type, data } = request.body;

    switch (event.type) {
      case "charge.succeeded":
        await Donateion.succeedCharge(event.data.object);
        break;
      case "charge.failed":
        await Donateion.failCharge("failed", event.data.object);
        break;
      case "charge.refunded":
        await Donateion.failCharge("refunded", event.data.object);
        break;
      case "charge.dispute.funds_withdrawn":
        await Donateion.failCharge(
          "dispute.funds_withdrawn",
          event.data.object
        );
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    return { success: true };
  }
}
