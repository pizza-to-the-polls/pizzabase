import { NextFunction, Request, Response } from "express";
import Stripe from "stripe";

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
      await sendNoMembershipFoundEmail(email, { email });
      return { success: true };
    }

    const token = await pack({ email, id });
    await sendCrustClubEmail(email, {
      token: `${process.env.STATIC_SITE}/session/${token}`,
    });

    return { success: true };
  }

  async update(request: Request, response: Response, _next: NextFunction) {
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: "2020-08-27",
        maxNetworkRetries: 6,
        timeout: 10_000,
      });

      const { email, id } = await unpack(request.body?.token || "");

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
