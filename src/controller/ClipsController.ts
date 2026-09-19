import { FindOptionsWhere } from "typeorm";
import { NextFunction, Request, Response } from "express";
import { Clip, ClipStatus } from "../entity/Clip";
import { Upload } from "../entity/Upload";
import { checkAuthorization, findOr404 } from "./helper";
import { deriveHashtags } from "../lib/clip-hashtags";
import { invokeRenderClip } from "../lib/clip-render";
import { notifyClipKit } from "../lib/clipKit";
import { notifyBugsnag } from "../lib/notifyBugsnag";
import { Link } from "../entity/Link";

const CLIP_STATUSES = [
  "queued",
  "rendering",
  "ready",
  "approved",
  "published",
  "rejected",
];

/**
 * Fire-and-forget render trigger. Only fires while the clip is queued —
 * never re-invokes a clip that is already rendering. The call is
 * intentionally not awaited: the HTTP response returns immediately and a
 * failed invocation leaves the clip queued (Bugsnag gets notified; a
 * requeue re-fires).
 */
const fireRender = (clip: Clip): void => {
  if (clip.status !== "queued") return;
  void invokeRenderClip(clip.id);
};

/**
 * Donation landing page every clip's short link points at. Overridable via
 * env (e.g. campaign-specific landing pages); falls back to the production
 * donate page.
 */
const donateLandingUrl = (): string =>
  process.env.DONATE_LANDING_URL || "https://www.polls.pizza/donate";

export class ClipsController {
  async create(request: Request, response: Response, _next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const { uploadId, city, state, reportedAt, captionText } =
      request.body || {};

    if (!uploadId || !city || !state || !reportedAt) {
      response.status(400);
      return {
        errors: ["uploadId, city, state, and reportedAt are required"],
      };
    }

    const upload = await Upload.findOne({
      where: { id: Number(uploadId) },
    });
    if (!upload) {
      response.status(404);
      return { errors: ["Upload not found"] };
    }

    if (upload.moderationStatus !== "clean") {
      response.status(400);
      return {
        errors: [
          "Upload must be moderated as clean before it can become a clip",
        ],
      };
    }

    if (upload.mediaStatus !== "ready") {
      response.status(400);
      return {
        errors: ["Upload media must be ready before it can become a clip"],
      };
    }

    const clip = new Clip();
    clip.upload = upload;
    clip.status = "queued";
    clip.kit = {
      caption: captionText || null,
      hashtags: deriveHashtags(city, state),
      city,
      state,
      reportedAt,
      shortUrlSlug: null,
    };
    await clip.save();

    // Short-link wiring (CLIP-003): every clip gets one trackable Link
    // pointing at the donation landing page, and the slug is stamped into
    // the render kit so the end-card carries a scannable QR + URL.
    // Fail-open (same philosophy as click tracking): a Link failure must
    // never block clip creation — the clip just renders with a null slug
    // (text-only end-card) instead.
    try {
      const link = await Link.createWithSlug({
        targetUrl: donateLandingUrl(),
        campaignTag: `clip-${clip.id}`,
        clipId: clip.id,
      });
      clip.kit = { ...clip.kit, shortUrlSlug: link.slug };
      await clip.save();
    } catch (err) {
      notifyBugsnag(err instanceof Error ? err : new Error(String(err)));
    }

    // Fire-and-forget: clip stays queued if invocation fails.
    fireRender(clip);

    return clip.asJSON();
  }

  async index(request: Request, response: Response, _next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const status = request.query.status as string | undefined;
    let where: FindOptionsWhere<Clip> = {};
    if (status) {
      if (!CLIP_STATUSES.includes(status)) {
        response.status(400);
        return { errors: [`Invalid status filter: ${status}`] };
      }
      where = { status: status as ClipStatus };
    }

    const [clips, count] = await Clip.findAndCount({
      where,
      relations: ["upload"],
      order: { createdAt: "DESC" },
    });

    return {
      results: clips.map((clip) => clip.asJSON()),
      count,
    };
  }

  async show(request: Request, response: Response, next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const clip = await findOr404(
      await Clip.findOne({
        where: { id: Number(request.params.id || "") },
        relations: ["upload"],
      }),
      response,
      next,
    );
    if (!clip) return;

    // Detail view: full operational fields beyond the public asJSON shape
    // (failureReason, publishLog, approval metadata, full kit).
    return {
      ...clip.asJSON(),
      kit: clip.kit,
      uploadId: clip.upload.id,
      failureReason: clip.failureReason,
      publishLog: clip.publishLog,
      approvedBy: clip.approvedBy,
      approvedAt: clip.approvedAt,
    };
  }

  async approve(request: Request, response: Response, next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const clip = await findOr404(
      await Clip.findOne({ where: { id: Number(request.params.id || "") } }),
      response,
      next,
    );
    if (!clip) return;

    if (!Clip.canTransition(clip.status, "approved")) {
      response.status(400);
      return {
        errors: [`Cannot approve clip in ${clip.status} state`],
      };
    }

    clip.status = "approved";
    // Auth context is just an API key; prefer an explicit identity from the
    // body (Retool passes the operator), fall back to a masked key.
    const apiKey = (request.headers.authorization || "").replace("Basic ", "");
    clip.approvedBy =
      (request.body || {}).approvedBy || `apikey:${apiKey.slice(0, 8)}…`;
    clip.approvedAt = new Date();

    await clip.save();

    // Fire-and-forget Slack kit distribution (DIST-001): the response
    // returns immediately and a failed notification never breaks clip
    // approval. notifyClipKit never throws (it logs + Bugsnags internally);
    // the .catch is purely defensive, mirroring the socialPost pattern.
    notifyClipKit(clip).catch((err) =>
      console.error("notifyClipKit crashed:", err),
    );

    return clip.asJSON();
  }

  /**
   * Publish confirmation (DIST-001, manual-first): a volunteer posted the
   * clip natively on a platform and closes the loop. Appends
   * { platform, postedAt, note? } to the clip's publishLog; the first
   * entry flips an approved clip to published. Allowed from approved or
   * published (repeats append more platforms to the same clip).
   */
  async publish(request: Request, response: Response, next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const clip = await findOr404(
      await Clip.findOne({ where: { id: Number(request.params.id || "") } }),
      response,
      next,
    );
    if (!clip) return;

    if (
      !Clip.canTransition(clip.status, "published") &&
      clip.status !== "published"
    ) {
      response.status(400);
      return { errors: [`Cannot publish clip in ${clip.status} state`] };
    }

    const { platform, note } = request.body || {};
    if (!platform || typeof platform !== "string") {
      response.status(400);
      return { errors: ["platform is required"] };
    }

    const entry: Record<string, unknown> = {
      platform,
      postedAt: new Date().toISOString(),
    };
    if (note && typeof note === "string") {
      entry.note = note;
    }

    // New array (not an in-place push) so TypeORM's jsonb change
    // detection reliably persists the append.
    clip.publishLog = [...(clip.publishLog || []), entry];

    // Only flip to published on the first entry; later confirmations just
    // append another platform to the same clip's log.
    if (clip.status !== "published") {
      clip.status = "published";
    }

    await clip.save();

    return clip.asJSON();
  }

  async reject(request: Request, response: Response, next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const { reason } = request.body || {};
    if (!reason || typeof reason !== "string") {
      response.status(400);
      return { errors: ["reason is required"] };
    }

    const clip = await findOr404(
      await Clip.findOne({ where: { id: Number(request.params.id || "") } }),
      response,
      next,
    );
    if (!clip) return;

    if (!Clip.canTransition(clip.status, "rejected")) {
      response.status(400);
      return {
        errors: [`Cannot reject clip in ${clip.status} state`],
      };
    }

    clip.status = "rejected";
    clip.failureReason = reason;

    await clip.save();

    return clip.asJSON();
  }

  async requeue(request: Request, response: Response, next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const clip = await findOr404(
      await Clip.findOne({ where: { id: Number(request.params.id || "") } }),
      response,
      next,
    );
    if (!clip) return;

    if (!Clip.canTransition(clip.status, "queued")) {
      response.status(400);
      return {
        errors: [`Cannot requeue clip in ${clip.status} state`],
      };
    }

    clip.status = "queued";
    clip.failureReason = null;
    clip.outputPaths = null;

    await clip.save();

    // Re-fire the render (the re-render loop for rejected clips).
    fireRender(clip);

    return clip.asJSON();
  }
}
