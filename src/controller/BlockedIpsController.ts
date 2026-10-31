import { NextFunction, Request, Response } from "express";
import { BlockedIp } from "../entity/BlockedIp";
import { checkAuthorization, findOr404 } from "./helper";
import { ipHash } from "../lib/ip-blocklist";

export class BlockedIpsController {
  async index(request: Request, response: Response, _next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const limit = Number(request.query.limit || 100);
    const take = limit < 100 ? limit : 100;
    const skip = Number(request.query.page || 0) * limit;

    const [blocks, count] = await BlockedIp.findAndCount({
      take,
      skip,
      order: { blockedAt: "DESC" },
    });

    return {
      results: blocks.map((block) => block.asJSON()),
      count,
    };
  }

  async show(request: Request, response: Response, next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const block: BlockedIp = await findOr404(
      await BlockedIp.findByIdOrIpHash(request.params.idOrIpHash || ""),
      response,
      next,
    );
    if (!block) return;

    return block.asJSON();
  }

  async create(request: Request, response: Response, _next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const { ip, reason, blockedBy } = request.body;

    // Normalize + hash with the app's own function — the same path the
    // submission checks use. Rejects unparseable IPs with 422.
    const hash = ipHash(ip || "");
    if (!hash) {
      response.status(422);
      return {
        errors: { ip: "Not a valid IP address" },
      };
    }

    const block = new BlockedIp();
    block.ipHash = hash;
    block.reason = reason || null;
    block.blockedBy = blockedBy || null;

    await block.save();

    return block.asJSON();
  }

  async delete(request: Request, response: Response, next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const block: BlockedIp = await findOr404(
      await BlockedIp.findOne({
        where: { id: Number(request.params.id || "") },
      }),
      response,
      next,
    );
    if (!block) return;

    await block.remove();

    return { success: true };
  }
}
