import { NextFunction, Request, Response } from "express";
import Bugsnag from "@bugsnag/js";

import { Donation } from "../entity/Donation";
import { processWebhook, sessionForCheckout } from "../lib/stripe";

export class DonationsController {
  async webhook(request: Request, response: Response, _next: NextFunction) {
    try {
      const { event, type } = processWebhook(
        request.body,
        request.headers["stripe-signature"],
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
          // Structured webhook logging (FEAT-004) — event type only, never
          // the payload.
          console.log(
            JSON.stringify({
              event: "stripe_webhook",
              type,
              outcome: "unhandled",
            }),
          );
          return { success: true };
      }

      console.log(
        JSON.stringify({ event: "stripe_webhook", type, outcome: "handled" }),
      );

      return { success: true };
    } catch (err) {
      response.status(400);
      // Signature/parse failure — no event type available, never log the
      // payload.
      console.log(
        JSON.stringify({ event: "stripe_webhook", outcome: "signature_error" }),
      );
      return { errors: [`Webhook Error: ${err.message}`] };
    }
  }

  async create(request: Request, _response: Response, _next: NextFunction) {
    const type = request.body?.type || "donation";

    try {
      const id = await sessionForCheckout({
        type,
        ...request.body,
      });

      // Structured checkout logging (FEAT-004) — no body contents in the log.
      console.log(
        JSON.stringify({
          event: "donation_checkout",
          outcome: "session_created",
          type,
        }),
      );

      return { success: true, checkoutSessionId: id };
    } catch (e) {
      // Outcome only — the raw error message may embed the checkout payload,
      // so it must NOT appear in the structured line.
      console.log(
        JSON.stringify({
          event: "donation_checkout",
          outcome: "failed",
          type,
        }),
      );

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
