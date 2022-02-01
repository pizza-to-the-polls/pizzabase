import { NextFunction, Request, Response } from "express";
import Stripe from "stripe";
import Bugsnag from "@bugsnag/js";

import { validateMembership } from "../lib/validator";
import { pack, unpack } from "../lib/jwt";
import { sendCrustClubEmail, sendNoMembershipFoundEmail } from "../lib/mailgun";

export class SessionController {
  async create(request: Request, response: Response, _next: NextFunction) {
    const { errors, email } = validateMembership(request.body || {});

    if (Object.keys(errors).length > 0) {
      response.status(422);
      return { errors };
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2020-08-27",
      maxNetworkRetries: 6,
      timeout: 10_000,
    });

    const {
      data: [customer],
    } = await stripe.customers.list({
      email,
    });
    const { id } = customer || { id: null };

    if (!id) {
      try {
        await sendNoMembershipFoundEmail(email, { email });
        return { success: true };
      } catch (e) {
        console.error(e);
        Bugsnag.notify(e, (event) => {
          event.severity = "error";
          event.addMetadata("request", {
            template: "crust-club-no-membership",
            ...request.body,
          });
        });

        return { errors: { emai: "We can't send emails at this time" } };
      }
    }

    const token = (await pack({ id })).replace(/\./g, "|||");

    try {
      await sendCrustClubEmail(email, {
        token: `${process.env.STATIC_SITE}/session/${token}/`,
      });
      return { success: true };
    } catch (e) {
      console.error(e);
      Bugsnag.notify(e, (event) => {
        event.severity = "error";
        event.addMetadata("request", {
          template: "crust-club-log-in",
          ...request.body,
        });
      });

      return { errors: { emai: "We can't send emails at this time" } };
    }
  }

  async update(request: Request, response: Response, _next: NextFunction) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: "2020-08-27",
        maxNetworkRetries: 6,
        timeout: 10_000,
      });

      const { id } = await unpack(
        (request.body?.token || "").replace(/\|\|\|/g, ".")
      );

      const { url } = await stripe.billingPortal.sessions.create({
        customer: id,
        return_url: `${process.env.STATIC_SITE}/crustclub`,
      });

      return { success: true, redirect: url };
    } catch (e) {
      response.status(410);

      return { errors: { token: "Invalid URL - please try again" } };
    }
  }
}
