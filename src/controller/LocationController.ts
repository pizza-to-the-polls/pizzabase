import { NextFunction, Request, Response } from "express";
import { Location } from "../entity/Location";
import { Report } from "../entity/Report";
import { FindOr404 } from "./helper";
import { zapNewReport } from "../lib/zapier";

export class LocationController {
  async all(_request: Request, _response: Response, _next: NextFunction) {
    return Location.find();
  }

  async one(request: Request, response: Response, _next: NextFunction) {
    return FindOr404(
      await Location.fidByIdOrFullAddress(request.params.idOrAddress || ""),
      response
    );
  }

  async validate(request: Request, response: Response, _next: NextFunction) {
    const location = FindOr404(
      await Location.fidByIdOrFullAddress(request.params.idOrAddress || ""),
      response
    );
    if (response.statusCode === 404) return location;

    await location.validate(request.body?.user);
    const openReports = await Report.find({ where: { location, order: null } });
    openReports.forEach(async (report) => await zapNewReport(report));

    return location;
  }
}
