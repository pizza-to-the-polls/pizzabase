import { NextFunction, Request, Response } from "express";
import Bugsnag from "@bugsnag/js";

import { Donation } from "../entity/Donation";
import { processWebhook, sessionForCheckout } from "../lib/stripe";
import { logEvent } from "../lib/logger";

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
          logEvent("donation.webhook.unhandled", { type });
      }

      logEvent("donation.webhook.processed", { type });
      return { success: true };
    } catch (err) {
      response.status(400);
      return { errors: [`Webhook Error: ${err.message}`] };
    }
  }

  async create(request: Request, _response: Response, _next: NextFunction) {
    const type = request.body?.type || "donation";

    // Same funnel shape as the report route: every attempt logs, then the
    // outcome. amountUsd/type are not PII; gift contact fields stay out.
    logEvent("donation.checkout.attempt", {
      type,
      amountUsd: request.body?.amountUsd ?? null,
      hasReferrer: Boolean(request.body?.referrer),
      hasUrl: Boolean(request.body?.url),
    });

    try {
      const id = await sessionForCheckout({
        type,
        ...request.body,
      });
      logEvent("donation.checkout.success", {
        type,
        amountUsd: request.body?.amountUsd ?? null,
        checkoutSessionId: id,
      });
      return { success: true, checkoutSessionId: id };
    } catch (e) {
      logEvent("donation.checkout.failed", {
        type,
        amountUsd: request.body?.amountUsd ?? null,
        message: e instanceof Error ? e.message : String(e),
      });
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
