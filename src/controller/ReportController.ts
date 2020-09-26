import { getRepository } from "typeorm";
import { NextFunction, Request, Response } from "express";
import { Location } from "../entity/Location";
import { Report } from "../entity/Report";
import { validateRequest } from "../lib/validator";

export class ReportController {
  private locRepo = getRepository(Location);
  private reportRepo = getRepository(Report);

  async create(request: Request, response: Response, next: NextFunction) {
    const {
      errors,
      normalizedAddress,
      reportURL,
      contactInfo,
    } = await validateRequest(request.body || {});

    if (Object.keys(errors).length > 0) {
      response.status(422);
      return { errors };
    }

    return { success: true };
  }
}
