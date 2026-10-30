/**
 * Lambda: prune-feed-observations
 *
 * Scheduled selective-retention prune for `feed_observations` (daily via
 * serverless.yml `schedule: rate(1 day)`). Implements #360's approved
 * "selective retention" policy:
 *
 *   Kept indefinitely — `domain = 'crowd'` rows (ground-truth reports, the
 *   calibration corpus) and `domain = 'social' AND relevant` rows
 *   (classifier picks: tiny volume, high value).
 *
 *   Pruned — everything else older than RETENTION_DAYS (default 30):
 *   govt readings and irrelevant social. These are the high-volume,
 *   fast-decaying rows (~15k/day in prod, overwhelmingly govt).
 *
 * WHY selective and not a flat TTL — #360's consumers table: the feedflag
 * daily digest needs only a ~26h window and Phase-4 corroboration needs
 * recent govt, but the JEV calibration backfill and season analytics want
 * the flagged + crowd corpus forever. That corpus is a small fraction of
 * the volume, so selective retention buys an unbounded-lived analytical
 * dataset at a bounded storage cost. A flat TTL would destroy the corpus
 * we exist to accumulate.
 *
 * LOAD-BEARING CONSTRAINT — never starve the digest: the retention window
 * must never be narrower than the digest window. GET
 * /feed-observations/summary (PR #359) serves the digest with a 26h
 * window, and the digest's loud floor (feedflag #69 / PR #70) refuses to
 * post when its window is implausibly small — so a retention window below
 * that would silently break the durable daily surface. RETENTION_DAYS >= 2
 * is therefore validated at startup, before any delete: a violation fails
 * the run with a clear log (a refused run, not a prod digest outage at
 * 02:00 UTC). If the digest window config ever moves, move this check in
 * the same change.
 *
 * Mechanism:
 *   - Batched DELETEs (~10k rows per statement) looped until a batch
 *     deletes 0 rows or the per-invocation batch cap is reached. Each
 *     batch auto-commits independently, so a failure mid-run leaves a
 *     consistent table and the next scheduled run resumes — no long-held
 *     transaction, no timeout rollback of the whole run.
 *   - Every value is a scalar bind parameter (watermark as $1::TIMESTAMPTZ,
 *     batch size as $2::INT); nothing is string-interpolated. No JS array
 *     bind parameters anywhere — the Aurora Data API driver throws on them
 *     ('param_N' is an invalid type) while the jest `postgres` driver
 *     happily accepts them (the PR #361 trap).
 *
 * Deliberately NOT done here: no VACUUM/REINDEX on a timer — autovacuum
 * handles bloat at these volumes. DO check pg_stat_user_tables
 * (n_dead_tuples / table size) after the first few real runs, per #360.
 *
 * Revisit conditions (documented, not implemented): election-scale volumes
 * (tens of millions of rows) may want table partitioning instead of
 * DELETEs (#360 option 3). The observed_at index (PR #359) keeps the prune
 * predicate cheap until then.
 */

import { AppDataSource, initializeDataSource } from "../data-source";
import { notifyBugsnag } from "../lib/notifyBugsnag";

/** Default retention window in days (env RETENTION_DAYS). */
export const DEFAULT_RETENTION_DAYS = 30;

/**
 * The floor. The feedflag digest reads GET /feed-observations/summary with
 * a ~26h window and its loud floor refuses to post when that window is
 * implausibly small — a retention window of 1 day could prune rows the
 * digest still needs. Never lower this without moving the digest window
 * config in the same change.
 */
export const MIN_RETENTION_DAYS = 2;

/** Rows deleted per DELETE statement. */
export const DEFAULT_BATCH_SIZE = 10_000;

/** Per-invocation cap so one run never holds a long transaction or blows
 * the 300s timeout; whatever remains is pruned by the next day's run. */
export const DEFAULT_MAX_BATCHES = 25;

/**
 * Parse + validate RETENTION_DAYS. Exported pure for tests.
 *
 * Throws (before anything is deleted) when the value is not a positive
 * integer or is below MIN_RETENTION_DAYS — see the docblock for why 2 is
 * the floor, not 1.
 */
export function parseRetentionDays(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") {
    return DEFAULT_RETENTION_DAYS;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      `[prune-feed-observations] RETENTION_DAYS must be a positive integer (got: ${JSON.stringify(raw)})`,
    );
  }
  if (n < MIN_RETENTION_DAYS) {
    throw new Error(
      `[prune-feed-observations] RETENTION_DAYS must be >= ${MIN_RETENTION_DAYS} (got ${n}): ` +
        `the feedflag daily digest reads GET /feed-observations/summary with a ~26h window, ` +
        `and a retention window narrower than that would starve it. Refusing to prune.`,
    );
  }
  return n;
}

export interface PruneOptions {
  /** Rows per DELETE statement. Defaults to DEFAULT_BATCH_SIZE. */
  batchSize?: number;
  /** Per-invocation batch cap. Defaults to DEFAULT_MAX_BATCHES. */
  maxBatches?: number;
}

export interface PruneResult {
  /** Rows deleted by this invocation. */
  totalDeleted: number;
  /** DELETE statements executed (a 0-row batch is not counted). */
  batchesRun: number;
  /** Rows that survive under the policy (kept forever). */
  keptCount: number;
  /** Total rows in the table after the run. */
  totalRemaining: number;
}

const LOG_PREFIX = "[prune-feed-observations]";

/**
 * One scheduled prune run. Split out of the handler so tests drive it
 * directly against the real test Postgres (real inserts, real deletes).
 *
 * Each DELETE is its own auto-committed statement (no explicit
 * transaction): a mid-run failure leaves every completed batch deleted and
 * the rest untouched — consistent, and the next run resumes.
 */
export async function runPrune(
  options: PruneOptions = {},
): Promise<PruneResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES;

  // Validate FIRST — nothing has been deleted at this point, so a config
  // violation is a refused run, not a half-pruned table.
  const retentionDays = parseRetentionDays(process.env.RETENTION_DAYS);
  const watermark = new Date(
    Date.now() - retentionDays * 24 * 3600 * 1000,
  ).toISOString();
  console.log(
    `${LOG_PREFIX} Starting prune: retention=${retentionDays}d, ` +
      `watermark=${watermark}, batchSize=${batchSize}, maxBatches=${maxBatches}`,
  );

  // Scalar binds only ($1 timestamp, $2 int) — no JS array parameters
  // (Aurora Data API trap) and nothing string-interpolated. The data-
  // modifying CTE returns the deleted count as a single scalar instead of
  // RETURNING 10k rows back through the Data API.
  const deleteSql = `
    WITH deleted AS (
      DELETE FROM feed_observations
      WHERE ctid IN (
        SELECT ctid FROM feed_observations
        WHERE (domain = 'govt'
               OR (domain = 'social' AND NOT COALESCE(relevant, false)))
          AND observed_at < $1::TIMESTAMPTZ
        LIMIT $2::INT
      )
      RETURNING 1
    )
    SELECT COUNT(*)::INT AS deleted FROM deleted
  `;

  const keptSql = `
    SELECT COUNT(*)::INT AS kept FROM feed_observations
    WHERE domain = 'crowd'
       OR (domain = 'social' AND COALESCE(relevant, false))
  `;
  const totalSql = `SELECT COUNT(*)::INT AS total FROM feed_observations`;

  try {
    let totalDeleted = 0;
    let batchesRun = 0;

    for (let i = 0; i < maxBatches; i++) {
      const batchStart = Date.now();
      const rows: Record<string, unknown>[] = await AppDataSource.manager.query(
        deleteSql,
        [watermark, batchSize],
      );
      const deleted = Number(rows[0]?.deleted ?? 0);
      if (deleted === 0) break;

      batchesRun += 1;
      totalDeleted += deleted;
      console.log(
        `${LOG_PREFIX} Batch ${batchesRun}: deleted ${deleted} rows ` +
          `in ${Date.now() - batchStart}ms (watermark: ${watermark})`,
      );
      if (deleted < batchSize) break; // predicate exhausted
    }

    const keptRows: Record<string, unknown>[] =
      await AppDataSource.manager.query(keptSql);
    const totalRows: Record<string, unknown>[] =
      await AppDataSource.manager.query(totalSql);
    const keptCount = Number(keptRows[0]?.kept ?? 0);
    const totalRemaining = Number(totalRows[0]?.total ?? 0);

    console.log(
      `${LOG_PREFIX} pruned ${totalDeleted} rows in ${batchesRun} batches; ` +
        `${keptCount} rows kept under the policy; ${totalRemaining} rows remain`,
    );

    return { totalDeleted, batchesRun, keptCount, totalRemaining };
  } catch (err) {
    console.error(
      `${LOG_PREFIX} Prune FAILED (watermark: ${watermark}, ` +
        `batches completed before failure are committed):`,
      err,
    );
    notifyBugsnag(err instanceof Error ? err : new Error(String(err)));
    // Fail loudly: this job is load-bearing for cost and PII hygiene
    // (#360) — swallowing a Data API error here is a bug, not resilience.
    throw err;
  }
}

export async function handler(event: unknown): Promise<void> {
  console.log(
    `${LOG_PREFIX} Scheduled run: ${JSON.stringify(event ?? {}).slice(0, 200)}`,
  );
  await initializeDataSource();
  await runPrune();
}
