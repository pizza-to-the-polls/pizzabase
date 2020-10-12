import { NextFunction, Request, Response } from "express";
import { Report } from "../entity/Report";
import { validateReport } from "../lib/validator";
import { zapNewReport, zapNewLocation } from "../lib/zapier";

export class ReportController {
  async create(request: Request, response: Response, _next: NextFunction) {
    const {
      errors,
      normalizedAddress,
      reportURL,
      contactInfo,
    } = await validateReport(request.body || {});

    if (Object.keys(errors).length > 0) {
      response.status(422);
      return { errors };
    }

    const [report, { isUniqueReport }] = await Report.createNewReport(
      contactInfo,
      reportURL,
      normalizedAddress
    );

    if (isUniqueReport) {
      if (report.location.validatedAt) {
        await zapNewReport(report);
      } else {
        await zapNewLocation(report);
      }
    }

    return { success: true };
  }
}
