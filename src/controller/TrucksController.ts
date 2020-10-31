import { NextFunction, Request, Response } from "express";
import { Truck } from "../entity/Truck";
import { isAuthorized } from "./helper";
import { validateTruck } from "../lib/validator";
import { zapNewTruck } from "../lib/zapier";

export class TrucksController {
  async all(request: Request, _response: Response, _next: NextFunction) {
    const limit = Number(request.query.limit || 100);
    const take = limit < 100 ? limit : 100;
    const skip = Number(request.query.page || 0) * limit;
    const past = !!request.query.past;
    const location = request.query.location
      ? { location: { id: request.query.location } }
      : {};

    const [trucks, count] = past
      ? await Truck.findAndCount({
          where: { ...location },
          order: { createdAt: "DESC" },
          take,
          skip,
        })
      : await Truck.findAndCountActiveTrucks({
          take,
          skip,
          location,
        });

    return {
      results: await Promise.all(
        trucks.map(async (truck) => ({
          ...truck.asJSON(),
          location: await truck.location.asJSON(),
        }))
      ),
      count,
    };
  }
  async create(request: Request, response: Response, next: NextFunction) {
    if (!(await isAuthorized(request, response, next))) return null;
    const { errors, normalizedAddress, identifier } = await validateTruck(
      request.body || {}
    );

    if (Object.keys(errors).length > 0) {
      response.status(422);
      return { errors };
    }

    const truck = await Truck.createForAddress(
      normalizedAddress,
      identifier,
      request.body?.user
    );
    await zapNewTruck(truck);

    return {
      address: truck.location.fullAddress,
    };
  }
}
