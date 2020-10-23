import { NextFunction, Request, Response } from "express";
import { Report } from "../entity/Report";
import { validateReport } from "../lib/validator";
import { zapNewReport, zapNewLocation } from "../lib/zapier";

export class ReportsController {
  async create(request: Request, response: Response, _next: NextFunction) {
    const {
      errors,
      normalizedAddress,
      reportURL,
      contactInfo,
      ...extra
    } = await validateReport(request.body || {});

    if (Object.keys(errors).length > 0) {
      response.status(422);
      return { errors };
    }

    const [
      report,
      { alreadyOrdered, isUnique, hasTruck, willReceive },
    ] = await Report.createNewReport(
      contactInfo,
      reportURL,
      normalizedAddress,
      extra
    );

    if ((isUnique || willReceive) && !hasTruck) {
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
