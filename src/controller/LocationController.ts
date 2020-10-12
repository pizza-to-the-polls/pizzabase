import { NextFunction, Request, Response } from "express";
import { Location } from "../entity/Location";
import { Order } from "../entity/Order";
import { FindOr404 } from "./helper";
import { zapNewReport } from "../lib/zapier";
import { validateOrder } from "../lib/validator";

export class LocationController {
  async all(_request: Request, _response: Response, _next: NextFunction) {
    return Location.find();
  }

  async one(request: Request, response: Response, _next: NextFunction) {
    const locationOrError = FindOr404(
      await Location.fidByIdOrFullAddress(request.params.idOrAddress || ""),
      response
    );
    if (!(locationOrError instanceof Location)) return locationOrError;

    const location: Location = locationOrError;

    return {
      ...location,
      reports: await location.reports,
      orders: await location.orders,
    };
  }

  async validate(request: Request, response: Response, _next: NextFunction) {
    const locationOrError = FindOr404(
      await Location.fidByIdOrFullAddress(request.params.idOrAddress || ""),
      response
    );
    if (!(locationOrError instanceof Location)) return locationOrError;

    const location: Location = locationOrError;

    const openReports = await location.validate(request.body?.user);

    openReports.reduce((reported: Set<string>, report) => {
      if (!reported.has(report.reportURL)) {
        zapNewReport(report);
        reported.add(report.reportURL);
      }
      return reported;
    }, new Set());

    return { success: true };
  }

  async skip(request: Request, response: Response, _next: NextFunction) {
    const locationOrError = FindOr404(
      await Location.fidByIdOrFullAddress(request.params.idOrAddress || ""),
      response
    );
    if (!(locationOrError instanceof Location)) return locationOrError;
    const location: Location = locationOrError;

    await location.skip(request.body?.user);

    return { success: true };
  }

  async order(request: Request, response: Response, _next: NextFunction) {
    const locationOrError = FindOr404(
      await Location.fidByIdOrFullAddress(request.params.idOrAddress || ""),
      response
    );
    if (!(locationOrError instanceof Location)) return locationOrError;

    const location: Location = locationOrError;
    const { errors, ...order } = validateOrder(request.body);

    if (Object.keys(errors).length > 0) {
      response.status(422);
      return { errors };
    }

    await Order.placeOrder(order, location);
    await location.validate(request.body?.user);

    return { success: true };
  }
}
