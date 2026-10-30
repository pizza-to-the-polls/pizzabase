import { NextFunction, Request, Response } from "express";

import { Report } from "../entity/Report";
import { Action } from "../entity/Action";
import { BannedPhoneNumber } from "../entity/BannedPhoneNumber";
import { validateReport } from "../lib/validator";
import { isValidPhone } from "../lib/validator/normalizeContact";
import { zapNewReport, zapNewLocation } from "../lib/zapier";
import { notifyBugsnag } from "../lib/notifyBugsnag";
import {
  isPartnerEmail,
  normalizeEmail,
  packPartnerSession,
  unpackPartnerSession,
} from "../lib/partners";
import { sendPartnerLoginEmail } from "../lib/mailgun";
import { createStreetViewUpload } from "../lib/streetview";

/**
 * Trusted partner report flow (staging rollout, 2026-10-30).
 *
 * POST /partner/session — magic-link login. Email must be on the hardcoded
 * partner allowlist (src/lib/partners.ts); response is generic either way
 * so the endpoint never reveals who is on the list.
 *
 * POST /partner/report — same trusted-report path as the API-key flow
 * (ReportsController.create with authed=true): address normalization,
 * banned-phone check, dedup, Action logged as "trusted report" attributed
 * to the partner, location auto-validated, normal Zapier webhooks. Two
 * partner-specific relaxations, per the partner form spec:
 *   - photo/video optional — when absent, a Google Street View image of
 *     the address is pulled through the normal media pipeline instead
 *   - contact info optional
 * waitTime stays required — it is the signal volunteers act on.
 */
export class PartnerReportsController {
  async session(request: Request, response: Response, _next: NextFunction) {
    const email = normalizeEmail(request.body?.email);

    if (!email || !email.includes("@")) {
      response.status(422);
      return {
        errors: { email: "Whoops! Please enter a valid email address." },
      };
    }

    if (isPartnerEmail(email)) {
      const token = await packPartnerSession(email);
      try {
        await sendPartnerLoginEmail(email, {
          link: `${process.env.STATIC_SITE}/partners/report?token=${token}`,
        });
      } catch (e) {
        notifyBugsnag(e as Error);
        response.status(500);
        return { errors: { email: "We can't send emails at this time" } };
      }
    }

    // Same generic success whether or not the email is allowlisted —
    // mirrors SessionController: don't leak allowlist membership.
    return { success: true };
  }

  async create(request: Request, response: Response, _next: NextFunction) {
    const token = (request.headers.authorization || "").replace("Bearer ", "");
    const partnerEmail = await unpackPartnerSession(token);

    if (!partnerEmail) {
      response.status(401);
      console.log(JSON.stringify({ event: "partner_report_not_authorized" }));
      return { errors: ["Not authorized"] };
    }

    const { errors, normalizedAddress, contactInfo, reportURL, ...extra } =
      await validateReport(request.body || {}, true);

    // Partner form: waitTime is the one field we require beyond the
    // trusted-report baseline (photo + contact are optional).
    if (!extra.waitTime) {
      errors.waitTime = "Whoops! Can you estimate the wait time?";
    }

    if (Object.keys(errors).length > 0) {
      response.status(422);
      // Field NAMES only, never values — same policy as FEAT-004.
      console.log(
        JSON.stringify({
          event: "partner_report_validation_failed",
          fields: Object.keys(errors),
        }),
      );
      return { errors };
    }

    // No photo from the partner: pull a Street View image of the location
    // through the normal media pipeline so the record still has media.
    // Failures fall back to the plain trusted-report flow.
    if (!request.body?.url && !request.body?.uploadId) {
      try {
        extra.upload = await createStreetViewUpload(
          normalizedAddress,
          request.ip,
        );
      } catch (e) {
        notifyBugsnag(e as Error);
      }
    }

    if (isValidPhone(contactInfo)) {
      if (await BannedPhoneNumber.isBanned(contactInfo)) {
        return {
          address: normalizedAddress.fullAddress,
          hasTruck: false,
          willReceive: false,
          alreadyOrdered: false,
        };
      }
    }

    const [report, { alreadyOrdered, isUnique, hasTruck, willReceive }] =
      await Report.createNewReport(
        contactInfo,
        reportURL,
        normalizedAddress,
        extra,
      );

    // Trusted-report extras, attributed to the logged-in partner (the
    // API-key flow uses request.body.user instead).
    await Action.log(report, "trusted report", partnerEmail);
    await report.location.validate(partnerEmail);

    if ((isUnique || willReceive) && !hasTruck && !alreadyOrdered) {
      if (report.location.validatedAt) {
        await zapNewReport(report);
      } else {
        await zapNewLocation(report);
      }
    }

    return {
      address: report.location.fullAddress,
      hasTruck,
      willReceive,
      alreadyOrdered,
    };
  }
}
