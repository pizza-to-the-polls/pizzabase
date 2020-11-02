import { NextFunction, Request, Response } from "express";
import { Location } from "../entity/Location";
import { Order } from "../entity/Order";
import { Truck } from "../entity/Truck";
import { findOr404, isAuthorized, checkAuthorization } from "./helper";
import {
  zapNewReport,
  zapSkipReport,
  zapNewOrder,
  zapNewTruck,
} from "../lib/zapier";
import { validateOrder } from "../lib/validator";

export class LocationsController {
  private async authorizeAndFindLocation(
    request: Request,
    response: Response,
    next: NextFunction
  ): Promise<Location | null> {
    if (!(await isAuthorized(request, response, next))) return null;

    return findOr404(
      await Location.fidByIdOrFullAddress(request.params.idOrAddress || ""),
      response,
      next
    );
  }

  async index(request: Request, _response: Response, _next: NextFunction) {
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

  async show(request: Request, response: Response, next: NextFunction) {
    const location: Location = await findOr404(
      await Location.fidByIdOrFullAddress(request.params.idOrAddress || ""),
      response,
      next
    );
    if (!location) return;

    const authorized = await checkAuthorization(request);
    const locJSON = await location.asJSON(authorized);
    const orders = await Order.find({
      where: { location, ...(authorized ? {} : { cancelledAt: null }) },
      order: { createdAt: "ASC" },
      relations: ["reports"],
    });
    const trucks = await Truck.find({
      where: { location },
      order: { createdAt: "ASC" },
      relations: ["reports"],
    });

    return {
      ...locJSON,
      hasTruck: authorized ? locJSON.hasTruck : await location.hasTruckJSON(),
      reports: (await location.openReports()).map((report) =>
        report.asJSON(authorized)
      ),
      orders: await Promise.all(
        orders.map(async (order) => ({
          ...order.asJSON(authorized),
          reports: (await order.reports).map((report) =>
            report.asJSON(authorized)
          ),
        }))
      ),
      trucks: await Promise.all(
        trucks.map(async (truck) => ({
          ...truck.asJSON(),
          reports: (await truck.reports).map((report) =>
            report.asJSON(authorized)
          ),
        }))
      ),
    };
  }

  async validate(request: Request, response: Response, next: NextFunction) {
    const location: Location = await this.authorizeAndFindLocation(
      request,
      response,
      next
    );
    if (!location) return;

    await location.validate(request.body?.user);
    const openReports = await location.openReports();
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

    const openReports = await location.openReports();
    await location.skip(request.body?.user);
    for (const report of openReports) {
      await zapSkipReport(report);
    }
    return { success: true };
  }

  async truck(request: Request, response: Response, next: NextFunction) {
    const location: Location | null = await this.authorizeAndFindLocation(
      request,
      response,
      next
    );

    if (!location) return;

    const truck = await location.assignTruck(
      request.body?.user,
      request.body?.city_state
    );

    await zapNewTruck(truck);

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

    await zapNewOrder(await Order.placeOrder(order, location));

    return { success: true };
  }

  async merge(request: Request, response: Response, next: NextFunction) {
    const location: Location | null = await this.authorizeAndFindLocation(
      request,
      response,
      next
    );
    if (!location) return;

    const { user, canonicalId } = request.body;

    const canonicalLocation = canonicalId
      ? await Location.findOne({ where: { id: canonicalId } })
      : null;

    if (!canonicalLocation) {
      response.status(422);
      return {
        errors: {
          canonicalId:
            "Whoops! Need a canonicalId of the location this is going to merge into",
        },
      };
    }

    await location.mergeInto(canonicalLocation, user);

    return { success: true };
  }
}
