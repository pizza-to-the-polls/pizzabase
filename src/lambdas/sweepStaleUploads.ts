/**
 * Lambda: sweepStaleUploads
 *
 * Scheduled stale-upload sweep (every 1 hour via serverless.yml
 * `schedule: rate(1 hour)`) — BUG-028 / issue #369.
 *
 * Problem: Upload.createOrReject() marks a web upload media_status
 * 'processing' before the browser completes the direct-to-S3 presigned
 * POST. If the browser upload fails (VPN drop, flaky connection, blocked
 * IP), the raw object never lands in the raw bucket, no S3 event fires,
 * and the row sits in 'processing' forever — invisible to reporting.
 *
 * Flow (per run):
 *   1. Select uploads with media_status 'processing' older than the 2-hour
 *      grace period (so in-flight uploads are never touched), in capped
 *      batches of sparse rows (see "Why the SELECT is shaped this way").
 *   2. HEAD each row's raw object in its raw bucket:
 *        - object absent            → failed, "raw object never arrived in
 *                                     S3 (client-side upload never completed)"
 *        - object present, 0 bytes  → failed, "raw object is empty (zero
 *                                     bytes)" (belt-and-braces for the
 *                                     0-byte class)
 *        - object present, > 0      → leave alone (media pipeline owns it)
 *   3. Log one structured line per run for CloudWatch:
 *        {"event":"upload_sweep", "stale": N, "failed": M, ...}
 *
 * Error granularity: only a definitive 404 counts as "absent". Transient
 * S3/network errors are logged and skipped — the next hourly run retries
 * them, so a bucket/permission hiccup can never mass-fail rows.
 *
 * Why the SELECT is shaped this way (BUG-035 / issue #394): the original
 * sweep loaded EVERY upload row older than the grace period as a full
 * entity (eager location join, exif_data/processed_file_path JSONB and
 * all) and filtered mediaStatus in JS, because the Aurora Data API can't
 * compare an enum column to a text bind parameter. Months of ready/failed
 * history came back in one ExecuteStatement response and blew through the
 * Data API's 1 MB single-response cap → UnsupportedResultException on
 * every hourly run, before a single S3 HEAD. The fix:
 *   - media_status is filtered IN SQL as an inlined literal ('processing'
 *     is a compile-time source constant — no injection surface; a literal
 *     is resolved by Postgres itself, so no enum-vs-text bind problem on
 *     either the local postgres driver or the Aurora Data API driver).
 *   - created_at (a timestamp column) is still a bound parameter — the
 *     timestamp-vs-parameter comparison always worked.
 *   - only the four columns the sweep touches (id, mediaStatus,
 *     rawBucket, rawFilePath) are selected — sparse entities; markFailed
 *     re-reads the full row via Upload.findOne before writing.
 *   - the query is paged by keyset cursor (id > afterId, not skip/offset,
 *     because rows leave the predicate as they are failed) with a
 *     per-invocation cap, so no future pathology can re-trigger the
 *     1 MB cap; leftover backlog resumes on the next hourly run.
 * The `stale` counter therefore means "stale rows examined this run
 * (capped)" — the pre-fix meaning ("all stale rows in history") never
 * actually worked.
 */

import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { initializeDataSource } from "../data-source";
import { Upload } from "../entity/Upload";

const GRACE_PERIOD_HOURS = 2;

/** Exact string the Oct 30 manual sweep used — history stays consistent. */
export const FAILURE_REASON_ABSENT =
  "raw object never arrived in S3 (client-side upload never completed)";

/** Belt-and-braces reason for the 0-byte class. */
export const FAILURE_REASON_EMPTY = "raw object is empty (zero bytes)";

const s3 = new S3Client({ region: process.env.AWS_REGION || "us-west-2" });

/** Rows fetched per batch — 500 × 4 short columns is tens of KB, far under
 * the Aurora Data API's 1 MB single-response cap (BUG-035 / #394). */
export const SWEEP_BATCH_SIZE = 500;

/** Per-invocation cap (~1,000 rows) so one run fits the 60s Lambda timeout.
 * The rest is swept by the next hourly run — every markFailed commits
 * independently and failed rows leave the predicate, so each run makes
 * durable progress. */
export const SWEEP_MAX_BATCHES = 2;

/**
 * One batch of stale rows: media_status 'processing', older than the
 * cutoff, with id above the keyset cursor. Sparse select — only the four
 * columns the sweep loop touches; every other field is undefined on the
 * returned entities (markFailed re-reads the full row).
 */
export async function fetchStaleUploadBatch(
  cutoff: Date,
  afterId: number,
  batchSize: number = SWEEP_BATCH_SIZE,
): Promise<Upload[]> {
  return (
    Upload.getRepository()
      .createQueryBuilder("u")
      .select(["u.id", "u.mediaStatus", "u.rawBucket", "u.rawFilePath"])
      // Enum literal INLINED, never bound: the Data API can't compare an
      // enum column to a text parameter (see clip-auto.ts). A constant
      // literal is the BUG-035 fix — the historical ready/failed bulk never
      // enters the response.
      .where("u.media_status = 'processing'")
      .andWhere("u.created_at < :cutoff", { cutoff })
      // Keyset cursor (not skip/offset): rows leave the predicate as they
      // are failed, so an OFFSET loop would slide over rows.
      .andWhere("u.id > :afterId", { afterId })
      .orderBy("u.id", "ASC")
      .take(batchSize)
      .getMany()
  );
}

/** True when an S3 error definitively means the object does not exist. */
export function isNotFoundError(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === "NotFound" ||
    e?.name === "NoSuchKey" ||
    e?.$metadata?.httpStatusCode === 404
  );
}

interface HeadResult {
  ContentLength?: number;
}

async function headRaw(bucket: string, key: string): Promise<HeadResult> {
  const cmd = new HeadObjectCommand({ Bucket: bucket, Key: key });
  return (await s3.send(cmd)) as HeadResult;
}

/**
 * Flip one row to 'failed', but only if it is still 'processing' — a fresh
 * read guards against clobbering a status the media pipeline flipped
 * forward between the sweep's SELECT and this write. Returns true when the
 * row was actually failed.
 */
async function markFailed(upload: Upload, reason: string): Promise<boolean> {
  const fresh = await Upload.findOne({ where: { id: upload.id } });
  if (!fresh || fresh.mediaStatus !== "processing") return false;
  fresh.mediaStatus = "failed";
  fresh.failureReason = reason;
  await fresh.save();
  return true;
}

/**
 * One sweep run. Split out of the handler so tests can drive it directly
 * with a mocked S3 layer (same pattern as compileClips.runCompilation).
 */
export async function sweepStaleUploads(): Promise<{
  stale: number;
  failed: number;
  absent: number;
  empty: number;
}> {
  const cutoff = new Date(Date.now() - GRACE_PERIOD_HOURS * 60 * 60 * 1000);

  let stale = 0;
  let failed = 0;
  let absent = 0;
  let empty = 0;
  let afterId = 0;
  let hitCap = false;

  for (let batch = 0; batch < SWEEP_MAX_BATCHES; batch++) {
    const staleRows = await fetchStaleUploadBatch(cutoff, afterId);
    if (staleRows.length === 0) break;

    stale += staleRows.length;
    afterId = staleRows[staleRows.length - 1].id;

    const counts = await sweepBatch(staleRows);
    failed += counts.failed;
    absent += counts.absent;
    empty += counts.empty;

    if (staleRows.length < SWEEP_BATCH_SIZE) break; // predicate exhausted
    if (batch === SWEEP_MAX_BATCHES - 1) hitCap = true;
  }

  if (hitCap) {
    console.warn(
      `[sweep-stale-uploads] Batch cap (${SWEEP_MAX_BATCHES} × ${SWEEP_BATCH_SIZE}) reached after ${stale} rows — ` +
        `any remaining backlog resumes on the next hourly run`,
    );
  }

  // Structured per-run summary for CloudWatch.
  console.log(
    JSON.stringify({ event: "upload_sweep", stale, failed, absent, empty }),
  );

  return { stale, failed, absent, empty };
}

/**
 * Examine one batch of sparse stale rows (the per-row logic). Returns the
 * batch's per-class counts so the run-level summary can aggregate them.
 */
async function sweepBatch(
  staleRows: Upload[],
): Promise<{ failed: number; absent: number; empty: number }> {
  let failed = 0;
  let absent = 0;
  let empty = 0;

  for (const upload of staleRows) {
    const where = upload.rawBucket
      ? `s3://${upload.rawBucket}/${upload.rawFilePath}`
      : "(no raw bucket/path recorded)";

    if (!upload.rawBucket || !upload.rawFilePath) {
      // No S3 coordinates — the object can't exist. Defensive: shouldn't
      // happen, but treat exactly like a never-arrived upload.
      if (await markFailed(upload, FAILURE_REASON_ABSENT)) {
        failed++;
        absent++;
        console.warn(
          `[sweep-stale-uploads] Upload ${upload.id} has no raw bucket/path (${where}) — marked failed`,
        );
      }
      continue;
    }

    try {
      const result = await headRaw(upload.rawBucket, upload.rawFilePath);
      const length = result?.ContentLength;

      if (length === undefined || length === 0) {
        // HEAD with no length reported, or a 0-byte object.
        if (
          await markFailed(
            upload,
            length === 0 ? FAILURE_REASON_EMPTY : FAILURE_REASON_ABSENT,
          )
        ) {
          failed++;
          if (length === 0) empty++;
          else absent++;
          console.warn(
            `[sweep-stale-uploads] Upload ${upload.id} raw object at ${where} ` +
              `${length === 0 ? "is empty (0 bytes)" : "has no content length"} — marked failed`,
          );
        }
      }
      // length > 0 → healthy object; the media pipeline owns it.
    } catch (err: any) {
      if (isNotFoundError(err)) {
        if (await markFailed(upload, FAILURE_REASON_ABSENT)) {
          failed++;
          absent++;
          console.warn(
            `[sweep-stale-uploads] Upload ${upload.id} raw object never arrived at ${where} — marked failed`,
          );
        }
      } else {
        // Transient S3/network error — log and skip; next run retries.
        console.error(
          `[sweep-stale-uploads] S3 HEAD error for upload ${upload.id} (${where}) — leaving in processing:`,
          err?.message || err,
        );
      }
    }
  }

  return { failed, absent, empty };
}

export async function handler(event: unknown): Promise<void> {
  console.log(
    `[sweep-stale-uploads] Scheduled run: ${JSON.stringify(event).slice(0, 200)}`,
  );
  await initializeDataSource();
  await sweepStaleUploads();
}
