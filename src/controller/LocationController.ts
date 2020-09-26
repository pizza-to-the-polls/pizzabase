import { getRepository } from "typeorm";
import { NextFunction, Request, Response } from "express";
import { Location } from "../entity/Location";

export class LocationController {
  private locationRepo = getRepository(Location);

  async all(request: Request, response: Response, next: NextFunction) {
    return this.locationRepo.find();
  }

  async one(request: Request, response: Response, next: NextFunction) {
    return this.locationRepo.findOne(request.params.fullAddress);
  }

  async upsert(request: Request, response: Response, next: NextFunction) {
    return this.locationRepo.save(request.body);
  }
}
