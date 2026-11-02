import { NextFunction, Request, Response } from "express";

import { Report } from "../entity/Report";
import { Action } from "../entity/Action";
import { BannedPhoneNumber } from "../entity/BannedPhoneNumber";
import { validateReport } from "../lib/validator";
import { isValidPhone } from "../lib/validator/normalizeContact";
import { zapNewReport, zapNewLocation, zapSkipReport } from "../lib/zapier";
import {
  applyAutoSkip,
  autoSkipPayload,
  evaluateAutoSkip,
  georgiaAutoSkipDecision,
  isAutoSkipEnabled,
  AutoSkipDecision,
} from "../lib/auto-skip";
import { notifyBugsnag } from "../lib/notifyBugsnag";
import {
  findPartnerUser,
  normalizeEmail,
  packPartnerSession,
  unpackPartnerSession,
} from "../lib/partners";
import { sendPartnerLoginEmail } from "../lib/mailgun";
import { attachStreetViewUrl } from "../lib/streetview";

/**
 * Trusted partner report flow (staging rollout, 2026-10-30).
 *
 * POST /partner/session — magic-link login. Email must be on the users
 * table (managed via the API-key-protected CRUD endpoints — Pizza Eagle
 * adds people on request); response is generic either way so the endpoint
 * never reveals who is on the list.
 *
 * POST /partner/report — same trusted-report path as the API-key flow
 * (ReportsController.create with authed=true): address normalization,
 * banned-phone check, dedup, Action logged as "trusted report" attributed
 * to the partner, location auto-validated, normal Zapier webhooks. Two
 * partner-specific relaxations, per the partner form spec:
 *   - photo/video optional — nothing enters the media pipeline when absent;
 *     the reportURL becomes the Street View proxy URL instead (see
 *     lib/streetview.ts)
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

    // Any user on the users table can magic-link in (that IS the partner
    // list); unknown emails get the same generic success so membership is
    // never revealed.
    if (await findPartnerUser(email)) {
      const token = await packPartnerSession(email);
      try {
        await sendPartnerLoginEmail(email, {
          // encodeURIComponent so the emailed URL carries only URL-safe
          // characters — raw `|` separators break auto-linking in some
          // email clients (link truncates at the first pipe => dead link).
          link: `${process.env.STATIC_SITE}/partners/report?token=${encodeURIComponent(token)}`,
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
    const partner = await unpackPartnerSession(token);
    const partnerEmail = partner?.email || null;

    if (!partner) {
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
      await Report.createNewReport(contactInfo, reportURL, normalizedAddress, {
        ...extra,
        // SB 22: Georgia reports are accepted and stored but auto-skipped at
        // creation — skippedAt lands on the INSERT itself, so the report is
        // never live, whatever the partner's authorization level.
        ...(georgiaAutoSkipDecision(normalizedAddress)
          ? { skippedAt: new Date() }
          : {}),
      });

    // Who validated what: the report row carries the FK to the partner.
    // Set before attachStreetViewUrl's save so it persists in the same write.
    report.trustedBy = partner;

    // No photo from the partner: their reportURL becomes the Street View
    // proxy URL (no Upload row — nothing enters the media pipeline, so
    // feedbot's collectMedia never attaches it and social posts stay
    // text-only). External reportURL surfaces (Help Scout, #feed-success,
    // Retool, /deliveries) resolve to a real image of the location.
    await attachStreetViewUrl(report);

    // Trusted-report extras, attributed to the logged-in partner (the
    // API-key flow uses request.body.user instead).
    await Action.log(report, "trusted report", partnerEmail);
    await report.location.validate(partnerEmail);

    // Auto-skip (no volunteer triage needed) when any condition holds:
    // Georgia (SB 22 compliance — unconditional, not flag-gated; partner
    // authorization must not unskip), pizza ordered for this location within
    // the last hour, or the reported line under an hour. The heuristics are
    // flag-gated (AUTO_SKIP_REPORTS).
    const georgiaSkip = georgiaAutoSkipDecision(normalizedAddress);
    let autoSkip: AutoSkipDecision | null = georgiaSkip;
    if (!autoSkip && isAutoSkipEnabled() && !hasTruck && !alreadyOrdered) {
      autoSkip = await evaluateAutoSkip(report);
    }

    if (autoSkip) {
      await applyAutoSkip(report, autoSkip);
      // Partner contacts are placeholder emails — isValidPhone is false, so
      // no submitter text fires here. Kept for parity with the public path.
      if (isValidPhone(report.contactInfo)) {
        await zapSkipReport(report, autoSkipPayload(autoSkip));
      }
    } else if ((isUnique || willReceive) && !hasTruck && !alreadyOrdered) {
      if (report.location.validatedAt) {
        await zapNewReport(report);
      } else {
        await zapNewLocation(report);
      }
    }

    return {
      address: report.location.fullAddress,
      hasTruck,
      // An auto-skipped report will not receive an order.
      willReceive: autoSkip ? false : willReceive,
      alreadyOrdered,
    };
  }
}
