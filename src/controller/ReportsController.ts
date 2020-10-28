import { NextFunction, Request, Response } from "express";
import { Report } from "../entity/Report";
import { Truck } from "../entity/Report";
import { Order } from "../entity/Report";
import { Location } from "../entity/Report";
import { validateReport } from "../lib/validator";
import { zapNewReport, zapNewLocation } from "../lib/zapier";

export class ReportsController {
  async index(request: Request, _response: Response, _next: NextFunction) {
    const limit = Number(request.query.limit || 100);
    const take = limit < 100 ? limit : 100;
    const skip = Number(request.query.page || 0) * limit;

    const truck = request.query.truck ? { truck: request.query.truck } : {};
    const order = request.query.order ? { order: request.query.order } : {};
    const location = request.query.location
      ? { location: request.query.location }
      : {};

    const where =
      truck || location || order ? { ...truck, ...order, ...location } : null;
    console.log(where);
    const [reports, count] = await Report.findAndCount({
      take,
      skip,
      where,
      order: { createdAt: "asc" },
    });

    return {
      results: await Promise.all(
        reports.map(async (loc) => await loc.asJSON())
      ),
      count,
    };
  }

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
