import { NextFunction, Request, Response } from "express";
import { Location } from "../entity/Location";

export class LocationController {
  async all(request: Request, response: Response, next: NextFunction) {
    return Location.find();
  }

  async one(request: Request, response: Response, next: NextFunction) {
    return Location.findOne(request.params.fullAddress);
  }

  async upsert(request: Request, response: Response, next: NextFunction) {
    return Location.save(request.body);
  }
}
