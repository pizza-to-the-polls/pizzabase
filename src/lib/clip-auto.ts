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
 * Not every skip is a content rejection, though. When a dispatcher skips
 * a location because pizza went there recently, the reports being
 * skipped describe the same line the pizza just fed — their media is
 * still clip-worthy. So a report is clip-worthy two ways: its own order,
 * or a skip at a location that was fed within the last few hours (see
 * RECENTLY_FED_HOURS).
 * Skip rescue is skip-time only: just the reports a skip itself marks —
 * reports skipped before this shipped are never revisited (no backfill,
 * by design).
 *
 * Two entry points:
 *   - seedClipsForOrder(order): called at order placement, so clips start
 *     rendering within seconds of the order.
 *   - seedClipsForRecentlyFedSkip(location, skippedReports): called when
 *     a location is skipped, so recently-fed skips render immediately
 *     too. The compileClips run's seedUnclippedOrderMedia() backstop
 *     stays order-linked-media only — it deliberately does NOT rescue
 *     skipped reports.
 *
 * All are idempotent (an upload with an existing clip, in any status, is
 * never double-seeded — POST /clips/:id/requeue re-fires renders) and
 * never throw: a failed seed just means the next scheduled run retries.
 */

import { In, IsNull, MoreThan, Not } from "typeorm";
import { Clip } from "../entity/Clip";
import { Location } from "../entity/Location";
import { Order } from "../entity/Order";
import { Report } from "../entity/Report";
import { Truck } from "../entity/Truck";
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

/**
 * How recently pizza must have gone to a location for a skip there to
 * count as a "recently fed" skip rather than a content rejection: an
 * order or truck assignment within the last 3 hours. A skip long after
 * the last delivery is a real decision, not a duplicate of one — only
 * the "we JUST fed this line" skips are rescue-worthy. Orders and truck
 * assignments both count (a truck is pizza delivery too).
 */
const RECENTLY_FED_HOURS = 3;

const daysAgo = (days: number): Date =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/**
 * Latest time pizza was sent to a location (order placed or truck
 * assigned) within RECENTLY_FED_HOURS before `asOf`, or null when the
 * location wasn't recently fed. Recent orders/trucks are loaded wide
 * and filtered in JS — the Aurora Data API can't express nested relation
 * filters here, and both relations load their location eagerly.
 */
async function latestFedAt(
  locationId: number,
  asOf: Date,
): Promise<Date | null> {
  const since = new Date(Number(asOf) - RECENTLY_FED_HOURS * 60 * 60 * 1000);
  const orders = await Order.find({ where: { createdAt: MoreThan(since) } });
  const trucks = await Truck.find({ where: { createdAt: MoreThan(since) } });

  const fedTimestamps = [...orders, ...trucks]
    .filter((sent) => sent.location?.id === locationId)
    .filter((sent) => new Date(sent.createdAt) < asOf)
    .map((sent) => new Date(sent.createdAt));

  return fedTimestamps.length > 0
    ? fedTimestamps.reduce((a, b) => (a > b ? a : b))
    : null;
}

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
 * Seed clips for every media-ready upload on one report — its web upload
 * plus any MMS replies linked to it. Shared by order placement and skip
 * rescue; seeding itself is idempotent per upload.
 */
async function seedReportMedia(report: Report): Promise<Clip[]> {
  const seeded: Clip[] = [];

  if (isSeedable(report.upload)) {
    const clip = await seedClipForUpload(report, report.upload);
    if (clip) seeded.push(clip);
  }

  // MMS replies linked to this report (arrive after delivery). No
  // mediaStatus predicate: the Aurora Data API can't compare enum
  // columns to text parameters — filter in JS instead.
  const mmsUploads = await Upload.find({
    where: { report: { id: report.id } },
  });
  for (const upload of mmsUploads) {
    if (upload.mediaStatus !== "ready") continue;
    const clip = await seedClipForUpload(report, upload);
    if (clip) seeded.push(clip);
  }

  return seeded;
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
      seeded.push(...(await seedReportMedia(report)));
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
 * Skip-time rescue: a skip at a location pizza was sent to within the
 * last RECENTLY_FED_HOURS means "we just fed this line", not "this
 * content is bad" — the reports being skipped describe the same line
 * the pizza fed, so their media is still clip-worthy and is seeded now
 * (renders fire within seconds, like placement-time seeding). Locations
 * not fed that recently seed nothing: their skips are real decisions.
 *
 * Only the reports passed in — the ones this skip is marking (the
 * controller's pre-skip openReports) — are seeded. There is no scan for
 * earlier skips and no backstop coverage: skipped reports from before
 * this shipped stay unclipped. Never throws. Returns the clips seeded.
 */
export async function seedClipsForRecentlyFedSkip(
  location: Location,
  skippedReports: Report[],
): Promise<Clip[]> {
  const seeded: Clip[] = [];
  try {
    // Fed-ness as of now, not the skip: an order placed moments after the
    // skip feeds the same line the skipped reports describe.
    const fedAt = await latestFedAt(location.id, new Date());
    if (!fedAt) return seeded;

    // Reload the skipped reports with their upload relation loaded —
    // openReports doesn't fetch it.
    const ids = skippedReports.map((report) => report.id);
    const reports = ids.length
      ? await Report.find({
          where: { id: In(ids) },
          relations: ["upload"],
        })
      : [];

    for (const report of reports) {
      seeded.push(...(await seedReportMedia(report)));
    }
    if (seeded.length > 0) {
      console.log(
        `[clip-auto] Skip rescue seeded ${seeded.length} clip(s) at recently-fed location ${location.id}`,
      );
    }
  } catch (err) {
    console.error(
      `[clip-auto] seedClipsForRecentlyFedSkip failed for location ${location.id}:`,
      err,
    );
    notifyBugsnag(err instanceof Error ? err : new Error(String(err)));
  }
  return seeded;
}

/**
 * Backstop scan for the scheduled run: find recent order-linked media
 * that hasn't become a clip yet and seed it. Covers everything
 * placement-time seeding misses (MMS replies arriving after the order,
 * late media processing, orders placed before this automation shipped).
 * Deliberately does NOT rescue skipped reports — skip rescue is
 * skip-time only (see seedClipsForRecentlyFedSkip), so nothing skipped
 * before this shipped is ever revisited. Returns the number of clips
 * seeded. Never throws.
 */
export async function seedUnclippedOrderMedia(): Promise<number> {
  try {
    const cutoff = daysAgo(SEED_WINDOW_DAYS);

    // Web uploads ride on reports (reports.upload_id); the report must
    // have an order.
    const reports = await Report.find({
      where: { order: Not(IsNull()), createdAt: MoreThan(cutoff) },
      relations: ["upload"],
    });

    // MMS uploads point back at their report (uploads.report_id); the
    // report's order is what makes them clip-worthy. mediaStatus and the
    // order linkage are filtered in JS (Aurora Data API can't compare
    // enum columns to text parameters, and nested relation filters on
    // report.order aren't expressible here).
    const mmsUploads = await Upload.find({
      where: { report: Not(IsNull()), createdAt: MoreThan(cutoff) },
      relations: { report: { order: true } },
    });

    let seeded = 0;
    for (const report of reports) {
      if (isSeedable(report.upload)) {
        if (await seedClipForUpload(report, report.upload)) seeded += 1;
      }
    }
    for (const upload of mmsUploads) {
      if (!upload.report) continue;
      if (upload.mediaStatus !== "ready") continue;
      if (!upload.report.order) continue; // order linkage makes it clip-worthy
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
