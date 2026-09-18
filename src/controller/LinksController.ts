import { NextFunction, Request, Response } from "express";
import { Link } from "../entity/Link";
import { LinkClick } from "../entity/LinkClick";
import { checkAuthorization, findOr404 } from "./helper";
import { notifyBugsnag } from "../lib/notifyBugsnag";

export class LinksController {
  /**
   * GET /l/:slug — 302 redirect to target URL with click tracking.
   * Anonymous (no auth). Click recording is fire-and-forget; if the DB insert
   * fails we still redirect (fail open) and log the loss to Bugsnag.
   */
  async redirect(
    request: Request,
    response: Response,
    _next: NextFunction,
  ): Promise<void> {
    const { slug } = request.params;
    const link = await Link.findOne({ where: { slug } });

    if (!link) {
      response.status(404).send({ errors: ["Short link not found"] });
      return;
    }

    // Fire-and-forget click recording — we do NOT await the save promise.
    // If recording fails, log to Bugsnag and move on.
    const click = new LinkClick();
    click.link = link;
    click.userAgent =
      (request.headers["user-agent"] as string | undefined) ?? null;
    click.referer = (request.headers["referer"] as string | undefined) ?? null;

    click.save().catch((e) => {
      notifyBugsnag(e instanceof Error ? e : new Error(String(e)));
    });

    response.redirect(302, link.targetUrl);
  }

  /**
   * POST /links — create a short link (admin auth required).
   * Body: { targetUrl, campaignTag, clipId? }
   * Returns the created link with its generated slug.
   */
  async create(request: Request, response: Response, _next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const { targetUrl, campaignTag, clipId } = request.body;

    if (!targetUrl) {
      response.status(400);
      return { errors: ["targetUrl is required"] };
    }
    if (!campaignTag) {
      response.status(400);
      return { errors: ["campaignTag is required"] };
    }

    const link = await Link.createWithSlug({
      targetUrl,
      campaignTag,
      clipId: clipId ?? null,
    });

    return {
      id: link.id,
      slug: link.slug,
      targetUrl: link.targetUrl,
      campaignTag: link.campaignTag,
      clipId: link.clipId,
      createdAt: link.createdAt,
    };
  }

  /**
   * GET /links/:slug/clicks — click stats (admin auth required).
   * Returns total count and the 50 most-recent clicks.
   */
  async clicks(request: Request, response: Response, next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const { slug } = request.params;
    const link: Link | null = await findOr404(
      await Link.findOne({ where: { slug } }),
      response,
      next,
    );
    if (!link) return;

    const count = await LinkClick.count({
      where: { link: { id: link.id } },
    });

    const recent = await LinkClick.find({
      where: { link: { id: link.id } },
      order: { clickedAt: "DESC" },
      take: 50,
    });

    return {
      count,
      recent: recent.map((c) => ({
        id: c.id,
        userAgent: c.userAgent,
        referer: c.referer,
        clickedAt: c.clickedAt,
      })),
    };
  }
}
