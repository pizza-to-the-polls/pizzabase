import { NextFunction, Request, Response } from "express";
import { Report } from "../entity/Report";
import { Action } from "../entity/Action";
import { Upload } from "../entity/Upload";
import { checkAuthorization, findOr404 } from "./helper";
import { validateReport } from "../lib/validator";
import { isValidPhone } from "../lib/validator/normalizeContact";
import { BannedPhoneNumber } from "../entity/BannedPhoneNumber";
import { zapNewReport, zapNewLocation } from "../lib/zapier";
import { cdnUrlFromStoredUrl } from "../lib/media-cdn";

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
   * (or failed) is included with cdnUrl: null so the moderation queue can
   * show in-flight items.
   */
  async media(request: Request, response: Response, next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
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
      moderationStatus: upload.moderationStatus,
      sightengineScore: upload.sightengineScore,
      createdAt: upload.createdAt,
      cdnUrl,
      processedUrls,
    };
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
    const authed = await checkAuthorization(request);

    const { errors, normalizedAddress, reportURL, contactInfo, ...extra } =
      await validateReport(request.body || {}, authed);

    if (Object.keys(errors).length > 0) {
      response.status(422);
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
      await Report.createNewReport(
        contactInfo,
        reportURL,
        normalizedAddress,
        extra,
      );

    if (authed) {
      await Action.log(report, "trusted report", request.body?.user);
      await report.location.validate(request.body?.user);
    }

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
