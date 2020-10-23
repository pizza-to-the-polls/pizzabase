import { NextFunction, Request, Response } from "express";
import { Location } from "../entity/Location";
import { Order } from "../entity/Order";
import { FindOr404, isAuthorized, checkAuthorization } from "./helper";
import { zapNewReport } from "../lib/zapier";
import { validateOrder } from "../lib/validator";

export class LocationsController {
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

  async all(request: Request, _response: Response, _next: NextFunction) {
    const limit = Number(request.query.limit || 100);
    const take = limit < 100 ? limit : 100;
    const skip = Number(request.query.page || 0) * limit;

    const [locations, count] = await Location.findAndCount({ take, skip });

    return {
      results: await Promise.all(
        locations.map(async (loc) => await loc.asJSON())
      ),
      count,
    };
  }

  async one(request: Request, response: Response, next: NextFunction) {
    const location: Location = await FindOr404(
      await Location.fidByIdOrFullAddress(request.params.idOrAddress || ""),
      response,
      next
    );
    if (!location) return;

    const authorized = await checkAuthorization(request);
    const locJSON = await location.asJSON(authorized);
    return {
      ...locJSON,
      hasTruck: authorized ? locJSON.hasTruck : await location.hasTruck(),
      reports: (await location.reports).map((report) =>
        report.asJSON(authorized)
      ),
      orders: (await location.orders).map((order) => order.asJSON(authorized)),
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
    const submittedReports: Set<string> = new Set();

    for (const report of openReports) {
      if (!submittedReports.has(report.reportURL)) {
        await zapNewReport(report);
        submittedReports.add(report.reportURL);
      }
    }

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

  async truck(request: Request, response: Response, next: NextFunction) {
    const location: Location | null = await this.authorizeAndFindLocation(
      request,
      response,
      next
    );

    if (!location) return;

    await location.assignTruck(request.body?.user, request.body?.city_state);
    return { success: true };
  }

  async order(request: Request, response: Response, next: NextFunction) {
    const location: Location | null = await this.authorizeAndFindLocation(
      request,
      response,
      next
    );
    if (!location) return;

    const { errors, ...order } = await validateOrder(request.body);

    if (Object.keys(errors).length > 0) {
      response.status(422);
      return { errors };
    }

    await Order.placeOrder(order, location);

    return { success: true };
  }
}
