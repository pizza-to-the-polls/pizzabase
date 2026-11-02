import { NextFunction, Request, Response } from "express";
import { BlockedIp } from "../entity/BlockedIp";
import { checkAuthorization, findOr404 } from "./helper";
import { ipHash } from "../lib/ip-blocklist";
import { updateWafIpSet } from "../lib/waf";

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

    // Edge enforcement (FEAT-007): also add the raw IP to the WAFv2 IP set
    // so the web ACL drops this address before it reaches the Lambda. The
    // raw IP goes only to the WAF API — never to the DB (hash only) and
    // never to the logs. Best-effort: updateWafIpSet never throws, so a WAF
    // failure cannot fail the DB block that already succeeded.
    await updateWafIpSet(ip, "ADD");

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

    // Edge enforcement (FEAT-007): remove the raw IP from the WAFv2 IP set
    // as well. The DB stores only the hash, so the caller must supply the
    // address being unblocked; it is only forwarded when it hashes to the
    // entry being deleted (never logged, never persisted). Best-effort: a
    // WAF failure must not fail the unblock.
    const { ip } = request.body;
    const hash = ipHash(ip || "");
    if (hash && hash === block.ipHash) {
      await updateWafIpSet(ip, "REMOVE");
    } else if (process.env.WAF_BLOCKED_IPSET_ARN) {
      console.warn(
        "blocked-ips: delete without a matching raw ip; WAF IP set entry left in place",
      );
    }

    return { success: true };
  }
}
