import { NextFunction, Request, Response } from "express";
import { Report } from "../entity/Report";
import { Action } from "../entity/Action";
import { checkAuthorization, findOr404 } from "./helper";
import { validateReport } from "../lib/validator";
import { zapNewReport, zapNewLocation } from "../lib/zapier";

export class ReportsController {
  async show(request: Request, response: Response, next: NextFunction) {
    const report: Report = await findOr404(
      await Report.findOne({ where: { id: Number(request.params.id || "") } }),
      response,
      next
    );
    if (!report) return;

    return {
      ...report.asJSON(),
      location: await report.location.asJSON(),
      order: (await report.order)?.asJSON(),
      truck: (await report.truck)?.asJSON(),
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

    const where =
      truck || location || order ? { ...truck, ...order, ...location } : {};

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
          order: report.order?.asJSON(),
          truck: report.truck?.asJSON(),
        }))
      ),
      count,
    };
  }

  async create(request: Request, response: Response, _next: NextFunction) {
    const authed = await checkAuthorization(request);

    const {
      errors,
      normalizedAddress,
      reportURL,
      contactInfo,
      ...extra
    } = await validateReport(request.body || {}, authed);

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
