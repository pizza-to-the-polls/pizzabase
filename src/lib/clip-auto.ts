/**
 * Automatic clip seeding — "any sent order is clip worthy".
 *
 * Orders no longer wait on a volunteer to POST /clips: their media is
 * seeded as queued clips automatically (the render fires immediately), and
 * the 3-hourly compileClips run folds every rendered clip into the reel
 * it posts to #feed-clips via the ZAP_NEW_CLIP hook. The report→order
 * gate is the only clip-worthiness rule — upload moderation no longer
 * gates clips.
 *
 * Two entry points:
 *   - seedClipsForOrder(order): called at order placement, so clips start
 *     rendering within seconds of the order.
 *   - seedUnclippedOrderMedia(): called by the compileClips run as a
 *     backstop for everything placement-time seeding misses — MMS replies
 *     that arrive after the order, media that was still processing, or
 *     orders placed before this automation shipped.
 *
 * Both are idempotent (an upload with an existing clip, in any status, is
 * never double-seeded — POST /clips/:id/requeue re-fires renders) and
 * never throw: a failed seed just means the next scheduled run retries.
 */

import { IsNull, MoreThan, Not } from "typeorm";
import { Clip } from "../entity/Clip";
import { Order } from "../entity/Order";
import { Report } from "../entity/Report";
import { Upload } from "../entity/Upload";
import { invokeRenderClip } from "./clip-render";
import { uploadPermalink } from "./upload-permalink";
import { photoEntryForUpload } from "./photo-entry";
import { notifyBugsnag } from "./notifyBugsnag";

/**
 * Only recent media auto-seeds via the scheduled backstop: old orders'
 * photos aren't feed content, and an unbounded backfill would bury the
 * queue (the renderClip budget caps renders at 50/day anyway, but the
 * queue should stay clean). Order-placement seeding has no window — it
 * seeds exactly the order being placed.
 */
const SEED_WINDOW_DAYS = 7;

/** Media on a report is seedable once the pipeline finished processing. */
const isSeedable = (upload: Upload | null): upload is Upload =>
  !!upload && upload.mediaStatus === "ready";

/**
 * Create a queued clip for one report's upload (unless it already has
 * one) and fire the render. Returns the new clip, or null when the
 * upload already has a clip / isn't ready / seeding failed.
 */
export async function seedClipForUpload(
  report: Report,
  upload: Upload,
): Promise<Clip | null> {
  try {
    const existing = await Clip.findOne({
      where: { upload: { id: upload.id } },
    });
    if (existing) return null;

    const clip = new Clip();
    clip.upload = upload;
    clip.status = "queued";
    clip.kit = {
      city: report.location.city,
      state: report.location.state,
      reportedAt: report.createdAt,
      photoLinks: [uploadPermalink(upload)],
      photos: [await photoEntryForUpload(upload)],
    };
    await clip.save();

    // invokeRenderClip never throws (logs + Bugsnags internally); a failed
    // invoke leaves the clip queued for the next scheduled run to reseed.
    await invokeRenderClip(clip.id);
    console.log(
      `[clip-auto] Seeded clip ${clip.id} from upload ${upload.id} (report ${report.id})`,
    );
    return clip;
  } catch (err) {
    console.error(
      `[clip-auto] Failed to seed clip for upload ${upload.id}:`,
      err,
    );
    notifyBugsnag(err instanceof Error ? err : new Error(String(err)));
    return null;
  }
}

/**
 * Seed clips for every media-ready upload on an order's reports — the
 * report's web upload plus any MMS replies already linked to it. Never
 * throws. Called at order placement.
 */
export async function seedClipsForOrder(order: Order): Promise<Clip[]> {
  const seeded: Clip[] = [];
  try {
    const reports = await Report.find({
      where: { order: { id: order.id } },
      relations: ["upload"],
    });

    for (const report of reports) {
      if (isSeedable(report.upload)) {
        const clip = await seedClipForUpload(report, report.upload);
        if (clip) seeded.push(clip);
      }

      const mmsUploads = await Upload.find({
        where: { report: { id: report.id }, mediaStatus: "ready" },
      });
      for (const upload of mmsUploads) {
        const clip = await seedClipForUpload(report, upload);
        if (clip) seeded.push(clip);
      }
    }
  } catch (err) {
    console.error(
      `[clip-auto] seedClipsForOrder failed for order ${order.id}:`,
      err,
    );
    notifyBugsnag(err instanceof Error ? err : new Error(String(err)));
  }
  return seeded;
}

/**
 * Backstop scan for the scheduled run: find recent order-linked media
 * that hasn't become a clip yet and seed it. Covers everything placement
 * seeding misses (MMS replies arriving after the order, late media
 * processing, orders placed before this automation shipped). Returns the
 * number of clips seeded. Never throws.
 */
export async function seedUnclippedOrderMedia(): Promise<number> {
  try {
    const cutoff = new Date(
      Date.now() - SEED_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    // Web uploads ride on reports (reports.upload_id); the report must
    // have an order.
    const reports = await Report.find({
      where: { order: Not(IsNull()), createdAt: MoreThan(cutoff) },
      relations: ["upload"],
    });

    // MMS uploads point back at their report (uploads.report_id); the
    // report's order is what makes them clip-worthy.
    const mmsUploads = await Upload.find({
      where: {
        report: { order: Not(IsNull()) },
        mediaStatus: "ready",
        createdAt: MoreThan(cutoff),
      },
      relations: ["report"],
    });

    let seeded = 0;
    for (const report of reports) {
      if (isSeedable(report.upload)) {
        if (await seedClipForUpload(report, report.upload)) seeded += 1;
      }
    }
    for (const upload of mmsUploads) {
      if (!upload.report) continue;
      if (await seedClipForUpload(upload.report, upload)) seeded += 1;
    }
    if (seeded > 0) {
      console.log(`[clip-auto] Backstop seeded ${seeded} new clip(s)`);
    }
    return seeded;
  } catch (err) {
    console.error("[clip-auto] seedUnclippedOrderMedia failed:", err);
    notifyBugsnag(err instanceof Error ? err : new Error(String(err)));
    return 0;
  }
}
