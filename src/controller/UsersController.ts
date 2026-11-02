import { NextFunction, Request, Response } from "express";

import { User } from "../entity/User";
import { findOr404, isAuthorized } from "./helper";
import { normalizeEmail } from "../lib/partners";
import { notifyBugsnag } from "../lib/notifyBugsnag";
import { sendPartnerWelcomeEmail } from "../lib/mailgun";

/**
 * Known-user CRUD (the users table behind trusted/partner reports).
 *
 * Every endpoint is API-key protected (Authorization: Basic <key>, the
 * same checkAuthorization path as the trusted-report API) — this is how
 * Pizza Eagle adds/removes people on request ("add jane@org.org from
 * Common Cause"): a Slack admin asks, pizza-eagle POSTs here with the
 * inbound token, the thread is the audit trail. reports.trusted_by
 * references these rows (ON DELETE SET NULL), and partner magic links
 * verify against this table on every submit.
 *
 * create() also sends the partner welcome email (Mailgun) — never blocking
 * the create; the response carries welcomeEmailSent so the operator can
 * follow up when Mailgun is down.
 */
export class UsersController {
  async index(request: Request, response: Response, next: NextFunction) {
    if (!(await isAuthorized(request, response, next))) return null;

    const users = await User.find({ order: { createdAt: "DESC" } });
    return {
      results: users.map((user) => user.asJSON()),
      count: users.length,
    };
  }

  async show(request: Request, response: Response, next: NextFunction) {
    if (!(await isAuthorized(request, response, next))) return null;

    const user: User | null = await findOr404(
      await User.findOne({
        where: { id: Number(request.params.id || "") },
      }),
      response,
      next,
    );
    if (!user) return null;

    return user.asJSON();
  }

  async create(request: Request, response: Response, _next: NextFunction) {
    if (!(await isAuthorized(request, response, _next))) return null;

    const email = normalizeEmail(request.body?.email);
    if (!email || !email.includes("@")) {
      response.status(422);
      return {
        errors: { email: "Whoops! A valid email address is required." },
      };
    }

    const existing = await User.findOne({ where: { email } });
    if (existing) {
      response.status(422);
      return {
        errors: {
          email: `Whoops! ${email} already has a user (id ${existing.id}).`,
        },
      };
    }

    const user = new User();
    user.email = email;
    user.firstName = (request.body?.firstName || null) ?? null;
    user.organization = (request.body?.organization || null) ?? null;
    user.admin = request.body?.admin === true;
    await user.save();

    // Welcome email — never blocks the create: the row is what grants
    // access, so a Mailgun outage must not fail the request. Surface the
    // send result instead, so the operator (pizza-eagle's answer in Slack)
    // can follow up by pointing the partner at the sign-in page.
    let welcomeEmailSent = true;
    try {
      await sendPartnerWelcomeEmail(user.email, {
        organization: user.organization,
      });
    } catch (e) {
      notifyBugsnag(e as Error);
      welcomeEmailSent = false;
    }

    response.status(201);
    return { ...user.asJSON(), welcomeEmailSent };
  }

  async update(request: Request, response: Response, next: NextFunction) {
    if (!(await isAuthorized(request, response, next))) return null;

    const user: User | null = await findOr404(
      await User.findOne({
        where: { id: Number(request.params.id || "") },
      }),
      response,
      next,
    );
    if (!user) return null;

    if (request.body?.email !== undefined) {
      const email = normalizeEmail(request.body.email);
      if (!email || !email.includes("@")) {
        response.status(422);
        return {
          errors: { email: "Whoops! A valid email address is required." },
        };
      }
      const existing = await User.findOne({ where: { email } });
      if (existing && existing.id !== user.id) {
        response.status(422);
        return {
          errors: {
            email: `Whoops! ${email} already belongs to another user.`,
          },
        };
      }
      user.email = email;
    }
    if (request.body?.firstName !== undefined) {
      user.firstName = request.body.firstName || null;
    }
    if (request.body?.organization !== undefined) {
      user.organization = request.body.organization || null;
    }
    if (request.body?.admin !== undefined) {
      user.admin = request.body.admin === true;
    }

    await user.save();
    return user.asJSON();
  }

  async remove(request: Request, response: Response, next: NextFunction) {
    if (!(await isAuthorized(request, response, next))) return null;

    const user: User | null = await findOr404(
      await User.findOne({
        where: { id: Number(request.params.id || "") },
      }),
      response,
      next,
    );
    if (!user) return null;

    // reports.trusted_by is ON DELETE SET NULL: attribution is nulled, no
    // cascade damage. Partner sessions for this user die on next submit
    // (unpackPartnerSession re-checks the table).
    await user.remove();

    return { success: true };
  }
}
