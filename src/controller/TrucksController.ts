import { NextFunction, Request, Response } from "express";
import { Truck } from "../entity/Truck";
import { isAuthorized } from "./helper";
import { validateTruck } from "../lib/validator";

export class TrucksController {
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

    return {
      address: truck.location.fullAddress,
    };
  }
}
