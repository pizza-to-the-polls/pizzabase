import { getRepository } from "typeorm";
import { NextFunction, Request, Response } from "express";
import { Location } from "../entity/Location";

export class UserController {
  private locationRepo = getRepository(Location);

  async all(request: Request, response: Response, next: NextFunction) {
    return this.locationRepo.find();
  }

  async one(request: Request, response: Response, next: NextFunction) {
    return this.locationRepo.findOne(request.params.id);
  }

  async save(request: Request, response: Response, next: NextFunction) {
    return this.locationRepo.save(request.body);
  }

  async remove(request: Request, response: Response, next: NextFunction) {
    let userToRemove = await this.locationRepo.findOne(request.params.id);
    await this.locationRepo.remove(userToRemove);
  }
}
