import { NextFunction, Request, Response } from "express";
import Bugsnag from "@bugsnag/js";

import { Donation } from "../entity/Donation";
import { processWebhook, sessionForCheckout } from "../lib/stripe";

export class DonationsController {
  async webhook(request: Request, response: Response, _next: NextFunction) {
    try {
      const { event, type } = processWebhook(
        request.body,
        request.headers["stripe-signature"]
      );

      switch (type) {
        case "charge.succeeded":
          await Donation.succeedCharge(event);
          break;
        case "charge.failed":
          await Donation.failCharge("failed", event);
          break;
        case "charge.refunded":
          await Donation.failCharge("refunded", event);
          break;
        case "charge.dispute.funds_withdrawn":
          await Donation.failCharge("dispute.funds_withdrawn", event);
          break;
        default:
          console.log(`Unhandled event type ${type}`);
      }

      return { success: true };
    } catch (err) {
      response.status(400);
      return { errors: [`Webhook Error: ${err.message}`] };
    }
  }

  async create(request: Request, _response: Response, _next: NextFunction) {
    try {
      const id = await sessionForCheckout({
        type: request.body?.type || "donation",
        ...request.body,
      });
      return { success: true, checkoutSessionId: id };
    } catch (e) {
      if (process.env.BUGSNAG_KEY) {
        Bugsnag.notify(e, (event) => {
          event.severity = "warning";
          event.addMetadata("request", {
            product: process.env.STRIPE_PRODUCT_ID,
            ...request.body,
          });
        });
      }
      console.error(e);
      return { success: false, message: e.message };
    }
  }
}
