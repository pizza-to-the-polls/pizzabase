import { NextFunction, Request, Response } from "express";
import { isAuthorized } from "./helper";
import { AppDataSource } from "../data-source";
import { IntegrationSession } from "../entity/IntegrationSession";

export class ThreadsTokenController {
  async update(request: Request, response: Response, next: NextFunction) {
    if (!(await isAuthorized(request, response, next))) return null;

    const { accessToken } = request.body || {};
    if (!accessToken) {
      response.status(422);
      return { errors: { accessToken: "accessToken is required" } };
    }

    const repo = AppDataSource.getRepository(IntegrationSession);
    let row = await repo.findOne({ where: { service: "threads" } });
    if (!row) {
      row = new IntegrationSession();
      row.service = "threads";
    }
    row.credentials = { accessToken };
    await repo.save(row);

    return { success: true };
  }
}
