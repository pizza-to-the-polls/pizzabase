import { NextFunction, Request, Response } from "express";
import { Report } from "../entity/Report";
import { Action } from "../entity/Action";
import { Upload } from "../entity/Upload";
import { User } from "../entity/User";
import { checkAuthorization, findOr404 } from "./helper";
import { validateReport } from "../lib/validator";
import { isValidPhone } from "../lib/validator/normalizeContact";
import { BannedPhoneNumber } from "../entity/BannedPhoneNumber";
import { BlockedIp } from "../entity/BlockedIp";
import { ipHash } from "../lib/ip-blocklist";
import { zapNewReport, zapNewLocation, zapSkipReport } from "../lib/zapier";
import { cdnUrlFromStoredUrl } from "../lib/media-cdn";
import {
  applyAutoSkip,
  autoSkipPayload,
  evaluateAutoSkip,
  georgiaAutoSkipDecision,
  isAutoSkipEnabled,
  AutoSkipDecision,
} from "../lib/auto-skip";
import {
  StreetViewImage,
  attachStreetViewUrl,
  fetchStreetViewImage,
} from "../lib/streetview";

export class ReportsController {
  async show(request: Request, response: Response, next: NextFunction) {
    const report: Report = await findOr404(
      await Report.findOne({ where: { id: Number(request.params.id || "") } }),
      response,
      next,
    );
    if (!report) return;

    return {
      ...report.asJSON(),
      location: await report.location.asJSON(),
      order: (await report.order)?.asJSON(),
      truck: (await report.truck)?.asJSON(),
    };
  }

  /**
   * Media viewer for Retool. GET /reports/:idOrAddress/media
   *
   * Returns all media associated with a report — inbound MMS replies
   * (linked via the Upload.report relation, newest first) plus the
   * report's original web upload (reports.upload_id) when present.
   *
   * URLs are rewritten against the media CDN via cdnUrlFromStoredUrl;
   * raw storage paths are never exposed. Media that is still processing
   * (or failed) is included with cdnUrl: null so in-flight items are visible.
   */
  async media(request: Request, response: Response, next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      console.log(JSON.stringify({ event: "report_not_authorized" }));
      return { errors: ["Not authorized"] };
    }

    const report: Report = await findOr404(
      await Report.findByIdOrReportUrl(request.params.idOrAddress || ""),
      response,
      next,
    );
    if (!report) return;

    // Inbound MMS media linked to this report, newest first.
    const mmsUploads = await Upload.find({
      where: { report: { id: report.id } },
      order: { createdAt: "DESC" },
    });

    const media = await Promise.all(
      mmsUploads.map((upload) => this.uploadToMediaItem(upload)),
    );

    // The report's original web upload (reports.upload_id), so Retool
    // volunteers get one view of all media for the report.
    if (report.upload) {
      media.push(await this.uploadToMediaItem(report.upload));
    }

    return {
      report: { id: report.id, reportURL: report.reportURL },
      media,
    };
  }

  /**
   * Shape an Upload for the media response. Applies the CDN rewrite to
   * every processed format and picks the primary URL (mp4 for video,
   * webp for images). Non-ready media always gets cdnUrl: null.
   */
  private async uploadToMediaItem(
    upload: Upload,
  ): Promise<Record<string, unknown>> {
    const processed = upload.processedFilePath as Record<string, string> | null;

    // Rewrite every processed format against the CDN. Skip non-URL entries
    // (e.g. the MediaConvert jobId stored alongside real outputs).
    const processedUrls: Record<string, string> = {};
    if (processed) {
      for (const [format, stored] of Object.entries(processed)) {
        if (!stored?.includes("/uploads/")) continue;
        processedUrls[format] = cdnUrlFromStoredUrl(stored);
      }
    }

    const cdnUrl =
      upload.mediaStatus === "ready"
        ? cdnUrlFromStoredUrl(processed?.mp4) ||
          cdnUrlFromStoredUrl(processed?.webp) ||
          cdnUrlFromStoredUrl(processed?.jpeg) ||
          cdnUrlFromStoredUrl(processed?.gif)
        : null;

    return {
      id: upload.id,
      source: upload.source,
      mediaStatus: upload.mediaStatus,
      sightengineScore: upload.sightengineScore,
      createdAt: upload.createdAt,
      cdnUrl,
      processedUrls,
    };
  }

  /**
   * Street View proxy. GET /reports/:id/streetview
   *
   * Serves a Google Street View image of the report's location, fetched
   * server-side so GOOGLE_MAPS_KEY never reaches the client. This is the
   * URL persisted as reports.url for trusted submissions without media
   * (see lib/streetview.ts) — public on purpose: every external surface
   * that links reportURL (Help Scout, #feed-success, Retool, the public
   * /deliveries and /activity pages) must resolve without credentials.
   */
  async streetview(request: Request, response: Response, next: NextFunction) {
    const report: Report = await findOr404(
      await Report.findOne({ where: { id: Number(request.params.id || "") } }),
      response,
      next,
    );
    if (!report) return;

    const { lat, lng } = report.location;
    const image: StreetViewImage | null = await fetchStreetViewImage(lat, lng);

    if (!image) {
      response.status(404);
      return { errors: ["No Street View imagery for this location"] };
    }

    // Imagery for a fixed address is effectively immutable — let browsers
    // and any fronting CDN hold it for a day instead of re-fetching Google.
    response.set("Content-Type", image.contentType);
    response.set("Cache-Control", "public, max-age=86400");
    response.send(image.bytes);
    return null;
  }

  async index(request: Request, _response: Response, _next: NextFunction) {
    const limit = Number(request.query.limit || 100);
    const take = limit < 100 ? limit : 100;
    const skip = Number(request.query.page || 0) * limit;

    const truck = request.query.truck
      ? { truck: { id: request.query.truck } }
      : {};
    const order = request.query.order
      ? { order: { id: request.query.order } }
      : {};
    const location = request.query.location
      ? { location: { id: request.query.location } }
      : {};

    const where = { ...truck, ...order, ...location };

    const [reports, count] = await Report.findAndCount({
      take,
      skip,
      where,
      relations: ["location", "truck", "order"],
      order: { createdAt: "DESC" },
    });

    return {
      results: await Promise.all(
        reports.map(async (report) => ({
          ...report.asJSON(),
          location: await report.location.asJSON(),
          order: (await report.order)?.asJSON(),
          truck: (await report.truck)?.asJSON(),
        })),
      ),
      count,
    };
  }

  async create(request: Request, response: Response, _next: NextFunction) {
    // IP blocklist check (issue #352) — before authorization and validation
    // so a blocked submission never geocodes, never creates rows, and never
    // runs the rest of the pipeline. req.ip comes from Express under the
    // existing trust-proxy handling; client-supplied headers are not read
    // directly.
    if (await BlockedIp.isBlocked(request.ip)) {
      console.log(
        JSON.stringify({
          event: "blocked_ip_rejected",
          route: "/report",
          // Hash only — the raw IP never reaches the logs (FEAT-004).
          ipHash: ipHash(request.ip),
        }),
      );
      response.status(403);
      return {
        errors: {
          _general:
            "Your submission was not accepted. If you believe this is in error, please contact us.",
        },
      };
    }

    const authed = await checkAuthorization(request);

    const { errors, normalizedAddress, reportURL, contactInfo, ...extra } =
      await validateReport(request.body || {}, authed);

    if (Object.keys(errors).length > 0) {
      response.status(422);
      // Structured validation logging (FEAT-004) — field NAMES only, never
      // values, so no PII reaches the logs.
      console.log(
        JSON.stringify({
          event: "report_validation_failed",
          fields: Object.keys(errors),
          authed,
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
          autoSkipped: false,
          skipReason: null,
        };
      }
    }

    const [report, { alreadyOrdered, isUnique, hasTruck, willReceive }] =
      await Report.createNewReport(contactInfo, reportURL, normalizedAddress, {
        ...extra,
        // SB 22: Georgia reports are accepted and stored (the line data is
        // valuable) but auto-skipped at creation — skippedAt is set on the
        // INSERT itself, so there is never a window where the report is live.
        ...(georgiaAutoSkipDecision(normalizedAddress)
          ? { skippedAt: new Date() }
          : {}),
      });

    // Trusted submissions without media get a Street View proxy URL as
    // their public reportURL (placeholder swaps in lib/streetview.ts).
    // Before the zap fires, so the Slack/HS payload carries the live link.
    await attachStreetViewUrl(report);

    if (authed) {
      // Who validated what: match body.user (an email, e.g. Retool's
      // "validated by" column) to a users row; the FK lands on the report.
      // No match (arbitrary string) leaves it null — Action.log still
      // records the raw string.
      const trustedUser = await User.findUserByEmail(request.body?.user);
      if (trustedUser) {
        report.trustedBy = trustedUser;
        await report.save();
      }
      await Action.log(report, "trusted report", request.body?.user);
      await report.location.validate(request.body?.user);
    }

    // Auto-skip (no volunteer triage needed) when any condition holds:
    // Georgia (SB 22 compliance — unconditional, not flag-gated, not
    // bypassable by trusted auth), pizza ordered for this location within
    // the last hour (the note tells the submitter when), or the reported
    // line is under an hour (the note asks them to resubmit once it passes
    // one). The heuristics are flag-gated (AUTO_SKIP_REPORTS); duplicates
    // already linked to an order and truck locations take the normal flows
    // either way.
    const georgiaSkip = georgiaAutoSkipDecision(normalizedAddress);
    let autoSkip: AutoSkipDecision | null = georgiaSkip;
    if (!autoSkip && isAutoSkipEnabled() && !hasTruck && !alreadyOrdered) {
      autoSkip = await evaluateAutoSkip(report);
    }

    if (autoSkip) {
      await applyAutoSkip(report, autoSkip);
      // The skip Zap texts the submitter — only real phone numbers get a
      // note (trusted/Retool reports use placeholder contacts).
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
      // An auto-skipped report will not receive an order — keep the
      // frontend's distributor confirmation from promising one.
      willReceive: autoSkip ? false : willReceive,
      alreadyOrdered,
      autoSkipped: !!autoSkip,
      skipReason: autoSkip?.reason ?? null,
    };
  }
}
