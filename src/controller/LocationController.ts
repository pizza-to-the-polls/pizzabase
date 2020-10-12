import { NextFunction, Request, Response } from "express";
import { Location } from "../entity/Location";
import { Order } from "../entity/Order";
import { FindOr404, isAuthorized } from "./helper";
import { zapNewReport } from "../lib/zapier";
import { validateOrder } from "../lib/validator";

export class LocationController {
  private async authorizeAndFindLocation(
    request: Request,
    response: Response,
    next: NextFunction
  ): Promise<Location | null> {
    if (!(await isAuthorized(request, response, next))) return null;

    return FindOr404(
      await Location.fidByIdOrFullAddress(request.params.idOrAddress || ""),
      response,
      next
    );
  }

  async all(_request: Request, _response: Response, _next: NextFunction) {
    return Location.find();
  }

  async one(request: Request, response: Response, next: NextFunction) {
    const location: Location = await FindOr404(
      await Location.fidByIdOrFullAddress(request.params.idOrAddress || ""),
      response,
      next
    );
    if (!location) return;

    return {
      ...location,
      reports: (await location.reports).map((report) => report.asJSON()),
      orders: (await location.orders).map((report) => report.asJSON()),
    };
  }

  async validate(request: Request, response: Response, next: NextFunction) {
    const location: Location = await this.authorizeAndFindLocation(
      request,
      response,
      next
    );
    if (!location) return;

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

  async skip(request: Request, response: Response, next: NextFunction) {
    const location: Location | null = await this.authorizeAndFindLocation(
      request,
      response,
      next
    );

    if (!location) return;

    await location.skip(request.body?.user);
    return { success: true };
  }

  async order(request: Request, response: Response, next: NextFunction) {
    const location: Location | null = await this.authorizeAndFindLocation(
      request,
      response,
      next
    );
    if (!location) return;

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
