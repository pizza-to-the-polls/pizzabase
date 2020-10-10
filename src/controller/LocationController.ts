import { NextFunction, Request, Response } from "express";
import { Location } from "../entity/Location";
import { FindOr404 } from "./helper";

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
}
