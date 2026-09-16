import { NextFunction, Request, Response } from "express";
import { BannedPhoneNumber } from "../entity/BannedPhoneNumber";
import { checkAuthorization, findOr404 } from "./helper";
import { normalizePhone } from "../lib/validator/normalizeContact";

export class BannedPhoneNumbersController {
  async index(request: Request, response: Response, _next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const limit = Number(request.query.limit || 100);
    const take = limit < 100 ? limit : 100;
    const skip = Number(request.query.page || 0) * limit;

    const [bans, count] = await BannedPhoneNumber.findAndCount({
      take,
      skip,
      order: { bannedAt: "DESC" },
    });

    return {
      results: bans.map((ban) => ban.asJSON()),
      count,
    };
  }

  async show(request: Request, response: Response, next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const ban: BannedPhoneNumber = await findOr404(
      await BannedPhoneNumber.findByIdOrPhoneNumber(
        request.params.idOrPhoneNumber || "",
      ),
      response,
      next,
    );
    if (!ban) return;

    return ban.asJSON();
  }

  async create(request: Request, response: Response, _next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const { phoneNumber, reason, bannedBy } = request.body;

    const ban = new BannedPhoneNumber();
    ban.phoneNumber = normalizePhone(phoneNumber || "");
    ban.reason = reason || null;
    ban.bannedBy = bannedBy || null;

    await ban.save();

    return ban.asJSON();
  }

  async delete(request: Request, response: Response, next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const ban: BannedPhoneNumber = await findOr404(
      await BannedPhoneNumber.findOne({
        where: { id: Number(request.params.id || "") },
      }),
      response,
      next,
    );
    if (!ban) return;

    await ban.remove();

    return { success: true };
  }
}
