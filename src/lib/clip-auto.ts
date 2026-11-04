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

import { In, MoreThan } from "typeorm";
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
 * Rows fetched per backstop scan batch — 100 rows × a few sparse columns
 * is a few KB, far under the Aurora Data API's 1 MB single-response cap.
 * BUG-042 / issue #407: the backstop used to load EVERY order-linked
 * report and upload in the 7-day window as FULL entities with their
 * joined relations (eager location/order joins, exif_data and
 * processed_file_path JSONB and all) in one ExecuteStatement response.
 * Election-day volume (~950 uploads) blew past the cap →
 * UnsupportedResultException on every scheduled run, so the backstop
 * died before compiling anything. The fix (same shape as BUG-035 / #394
 * in sweepStaleUploads):
 *   - the window scan is a NARROW select (ids + mediaStatus only); full
 *     entities are loaded only for the small set of actual seed
 *     candidates, after a bulk existing-clip check;
 *   - the scan is paged with take/skip, so no single response can exceed
 *     the cap regardless of window volume;
 *   - readiness stays filtered in JS (media_status is an enum column:
 *     the Data API can't compare it to a text parameter), while the
 *     order linkage becomes a SQL predicate via inner joins (a join, not
 *     an enum-vs-text comparison, so it is Data API safe).
 */
export const SEED_BATCH_SIZE = 100;

/** Per-backstop-run cap (batches per phase): one scheduled run scans at
 * most SEED_MAX_BATCHES × SEED_BATCH_SIZE rows per phase; leftover
 * backlog resumes on the next run (every seed commits independently, so
 * each run makes durable progress). */
export const SEED_MAX_BATCHES = 50;

/**
 * Bulk existing-clip check for one scan batch: which of these uploads
 * already have ANY clip row (any status — idempotence means a clip in
 * any state counts)? One IN(...) query per batch instead of a
 * per-upload Clip.findOne keeps the seed phase at O(batch) queries, and
 * keeps the full-entity load to uploads that would actually seed.
 */
async function uploadIdsWithClips(uploadIds: number[]): Promise<Set<number>> {
  if (uploadIds.length === 0) return new Set();
  const rows = await Clip.getRepository()
    .createQueryBuilder("c")
    .select("u.id", "uploadId")
    .innerJoin("c.upload", "u")
    .where("u.id IN (:...ids)", { ids: uploadIds })
    .getRawMany();
  return new Set(rows.map((row) => Number(row.uploadId)));
}

/**
 * One raw scan row for the web phase: report id plus the linked web
 * upload's id and mediaStatus. mediaStatus is a Postgres enum column —
 * it is SELECTED here (selects are safe) but never COMPARED in SQL, and
 * the readiness filter runs in JS after the batch comes back.
 */
interface WebScanRow {
  reportId: number;
  uploadId: number | null;
  mediaStatus: string | null;
}

/**
 * One batch of recent order-linked reports with their web upload
 * (reports.upload_id): narrow getRawMany scan — only report id plus the
 * upload's id and mediaStatus. The order linkage is a SQL predicate via
 * an inner join on the report's order relation (a join, not an enum
 * comparison, so it is Data API safe). Full entities are loaded per
 * candidate by seedWebUploads.
 */
async function fetchWebBatch(
  cutoff: Date,
  offset: number,
  batchSize: number,
): Promise<WebScanRow[]> {
  return Report.getRepository()
    .createQueryBuilder("r")
    .select("r.id", "reportId")
    .addSelect("u.id", "uploadId")
    .addSelect("u.mediaStatus", "mediaStatus")
    .leftJoin("r.upload", "u")
    .innerJoin("r.order", "o")
    .where("r.created_at > :cutoff", { cutoff })
    .orderBy("r.id", "ASC")
    .take(batchSize)
    .skip(offset)
    .getRawMany();
}

/**
 * One raw scan row for the MMS phase: upload id/mediaStatus plus the
 * report id. The report→order linkage is a SQL predicate via inner
 * joins on the report and its order.
 */
interface MmsScanRow {
  uploadId: number;
  reportId: number | null;
  mediaStatus: string | null;
}

/**
 * One batch of recent MMS uploads (uploads.report_id): narrow getRawMany
 * scan — only upload id/mediaStatus plus the report id.
 */
async function fetchMmsBatch(
  cutoff: Date,
  offset: number,
  batchSize: number,
): Promise<MmsScanRow[]> {
  return Upload.getRepository()
    .createQueryBuilder("u")
    .select("u.id", "uploadId")
    .addSelect("u.mediaStatus", "mediaStatus")
    .addSelect("r.id", "reportId")
    .innerJoin("u.report", "r")
    .innerJoin("r.order", "o")
    .where("u.created_at > :cutoff", { cutoff })
    .orderBy("u.id", "ASC")
    .take(batchSize)
    .skip(offset)
    .getRawMany();
}

/**
 * Backstop scan Phase A: web uploads riding on order-linked reports
 * (reports.upload_id). Paged by take/skip (safe here — the scan mutates
 * nothing these rows depend on, so offset windows stay stable). Per
 * batch: JS-side readiness filter → bulk existing-clip check → full
 * entity load only for actual seed candidates → seed. Bounded by
 * SEED_MAX_BATCHES; leftover backlog resumes on the next scheduled run.
 */
async function seedWebUploads(
  cutoff: Date,
  batchSize: number,
): Promise<number> {
  let seeded = 0;
  let offset = 0;
  let hitCap = false;
  for (let batch = 0; batch < SEED_MAX_BATCHES; batch++) {
    const rows = await fetchWebBatch(cutoff, offset, batchSize);
    if (rows.length === 0) break;
    offset += batchSize;

    // Readiness is filtered in JS: media_status is an enum column and
    // the Aurora Data API can't compare it to a text bind parameter.
    const seedable = rows.filter(
      (row): row is WebScanRow & { uploadId: number } =>
        row.uploadId !== null && row.mediaStatus === "ready",
    );
    const clippedIds = await uploadIdsWithClips(
      seedable.map((row) => row.uploadId),
    );
    const candidateIds = seedable
      .filter((row) => !clippedIds.has(row.uploadId))
      .map((row) => row.reportId);

    if (candidateIds.length > 0) {
      // Full entities only for the actual seed candidates — the narrow
      // scan rows don't carry the location/kit data seeding needs.
      const candidates = await Report.find({
        where: { id: In(candidateIds) },
        relations: ["upload", "location"],
      });
      for (const report of candidates) {
        if (
          isSeedable(report.upload) &&
          (await seedClipForUpload(report, report.upload))
        ) {
          seeded += 1;
        }
      }
    }

    if (rows.length < batchSize) break; // predicate exhausted
    if (batch === SEED_MAX_BATCHES - 1) hitCap = true;
  }
  if (hitCap) {
    console.warn(
      `[clip-auto] Web-upload seed batch cap (${SEED_MAX_BATCHES} × ${batchSize}) reached — ` +
        `remaining backlog resumes on the next scheduled run`,
    );
  }
  return seeded;
}

/**
 * Backstop scan Phase B: MMS uploads pointing back at order-linked
 * reports (uploads.report_id). Same narrow-select + take/skip shape as
 * Phase A; readiness is filtered in JS, order linkage in SQL via the
 * report→order inner join.
 */
async function seedMmsUploads(
  cutoff: Date,
  batchSize: number,
): Promise<number> {
  let seeded = 0;
  let offset = 0;
  let hitCap = false;
  for (let batch = 0; batch < SEED_MAX_BATCHES; batch++) {
    const rows = await fetchMmsBatch(cutoff, offset, batchSize);
    if (rows.length === 0) break;
    offset += batchSize;

    const seedable = rows.filter(
      (row): row is MmsScanRow & { reportId: number } =>
        row.reportId !== null && row.mediaStatus === "ready",
    );
    const clippedIds = await uploadIdsWithClips(
      seedable.map((row) => row.uploadId),
    );
    const candidateIds = seedable
      .filter((row) => !clippedIds.has(row.uploadId))
      .map((row) => row.uploadId);

    if (candidateIds.length > 0) {
      // Full entities only for the actual seed candidates; report's
      // eager location/order and upload's eager location load with it.
      const candidates = await Upload.find({
        where: { id: In(candidateIds) },
        relations: ["report"],
      });
      for (const upload of candidates) {
        if (
          upload.report &&
          upload.mediaStatus === "ready" &&
          (await seedClipForUpload(upload.report, upload))
        ) {
          seeded += 1;
        }
      }
    }

    if (rows.length < batchSize) break; // predicate exhausted
    if (batch === SEED_MAX_BATCHES - 1) hitCap = true;
  }
  if (hitCap) {
    console.warn(
      `[clip-auto] MMS-upload seed batch cap (${SEED_MAX_BATCHES} × ${batchSize}) reached — ` +
        `remaining backlog resumes on the next scheduled run`,
    );
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
 *
 * Reads are batch-safe (BUG-042 / issue #407): narrow selects +
 * take/skip paging keep every Data API response far under the 1 MB cap
 * regardless of window volume — see SEED_BATCH_SIZE. `batchSize` is a
 * parameter only so tests can exercise multi-batch paging cheaply;
 * production callers use the default.
 */
export async function seedUnclippedOrderMedia(
  batchSize: number = SEED_BATCH_SIZE,
): Promise<number> {
  try {
    const cutoff = daysAgo(SEED_WINDOW_DAYS);

    const seeded =
      (await seedWebUploads(cutoff, batchSize)) +
      (await seedMmsUploads(cutoff, batchSize));

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
