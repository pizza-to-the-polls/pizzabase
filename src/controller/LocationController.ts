import { NextFunction, Request, Response } from "express";
import { Location } from "../entity/Location";
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
    const locationOrError = FindOr404(
      await Location.fidByIdOrFullAddress(request.params.idOrAddress || ""),
      response
    );
    if (!(locationOrError instanceof Location)) return locationOrError;
    const location: Location = locationOrError;

    const openReports = await location.validate(request.body?.user);

    openReports.forEach(async (report) => await zapNewReport(report));

    return location;
  }

  async skip(request: Request, response: Response, _next: NextFunction) {
    const locationOrError = FindOr404(
      await Location.fidByIdOrFullAddress(request.params.idOrAddress || ""),
      response
    );
    if (!(locationOrError instanceof Location)) return locationOrError;
    const location: Location = locationOrError;

    await location.skip(request.body?.user);

    return location;
  }
}
