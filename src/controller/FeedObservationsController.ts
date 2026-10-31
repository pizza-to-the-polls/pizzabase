import { NextFunction, Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { FeedObservation } from "../entity/FeedObservation";
import { checkAuthorization } from "./helper";

// Number of columns per inserted observation row — used to compute
// positional parameter offsets in the bulk INSERT below.
const INSERT_COLUMNS = 15;

// PostgreSQL's default hard limit is 65535 bind parameters per statement.
// Keep the largest accepted batch comfortably below it.
const MAX_BATCH = 3000;

type ObservationInput = Record<string, any>;

/**
 * Normalize a raw client-supplied timestamp to an ISO 8601 string suitable
 * for a `$n::TIMESTAMPTZ` bind parameter, or null if the value is absent or
 * unparseable. Mirrors the normalization feedflag does in
 * `scripts/emit-to-db.ts` so the endpoint tolerates the same input shapes.
 *
 * Accepts:
 *  - null / undefined → null
 *  - JS number → epoch-millis (if > 1e12) or epoch-seconds (× 1000)
 *  - digit-only string matching /^\d{12,14}$/ → parsed as epoch-millis
 *  - string parseable by `new Date()` → ISO 8601 (UTC)
 *  - anything else (booleans, objects, garbage strings) → null
 */
export function toIsoTimestamp(v: unknown): string | null {
  if (v === null || v === undefined) return null;

  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    // Heuristic: values > 1e12 are epoch-millis; anything smaller is
    // treated as epoch-seconds.
    return new Date(v > 1e12 ? v : v * 1000).toISOString();
  }

  if (typeof v === "string") {
    if (/^\d{12,14}$/.test(v)) {
      // Digit-only string in the epoch-millis magnitude range (e.g. the
      // Bugsnag-provoking "1792642500000").
      return new Date(Number.parseInt(v, 10)).toISOString();
    }
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }

  return null;
}

/**
 * Normalize a json_agg column across drivers: the `postgres` driver parses
 * it into a JS array (what the jest suite sees), but the Aurora Data API
 * returns it as a JSON STRING — observed in prod 2026-10-30, where an
 * Array.isArray() check silently degraded it to [] and the digest would
 * have posted counts with an empty flagged table. Anything else (null,
 * unparseable) degrades to an empty array rather than throwing.
 */
export function jsonColumn(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * feedflag machine-token observation intake (FEAT-002d).
 *
 * POST /feed-observations — bulk insert of feedflag/observation@1 records,
 *   idempotent on (source_ref, observed_at) via ON CONFLICT DO NOTHING.
 * GET /feed-observations — paginated newest-first read-back so feedflag CI
 *   can verify its emit without DB credentials.
 * GET /feed-observations/summary — windowed aggregate for the daily digest
 *   and other consumers; one round-trip, no pagination, no PII.
 */
export class FeedObservationsController {
  async create(request: Request, response: Response, _next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const { observations } = request.body || {};
    if (!Array.isArray(observations) || observations.length === 0) {
      response.status(400);
      return {
        errors: ["observations array is required and must be non-empty"],
      };
    }
    if (observations.length > MAX_BATCH) {
      response.status(413);
      return {
        errors: [`Batch too large: max ${MAX_BATCH} observations per request`],
      };
    }

    // Validate/normalize timestamps (and wait_minutes) before building the
    // INSERT so that a single malformed row is a clean 400 naming the row
    // index instead of an unhandled Postgres cast error (22008) that would
    // 500 the whole batch. BUG-019.
    const errors: string[] = [];
    const normalizedTimestamps: Array<{
      observedAt: string | null;
      postedAt: string | null;
    }> = [];

    observations.forEach((o: ObservationInput, i: number) => {
      const observedAt = toIsoTimestamp(o.observed_at);
      if (observedAt === null) {
        // observed_at is required (half the idempotency key) — never
        // substitute a fabricated value like new Date(), which would
        // corrupt ON CONFLICT (source_ref, observed_at) dedup.
        errors.push(
          `observations[${i}].observed_at is not a valid timestamp: ${JSON.stringify(
            o.observed_at ?? null,
          )}`,
        );
      }

      const waitMinutes = o.wait_minutes;
      if (
        waitMinutes !== null &&
        waitMinutes !== undefined &&
        (!Number.isFinite(Number(waitMinutes)) ||
          !Number.isInteger(Number(waitMinutes)))
      ) {
        errors.push(
          `observations[${i}].wait_minutes must be an integer: ${JSON.stringify(
            waitMinutes,
          )}`,
        );
      }

      normalizedTimestamps.push({
        observedAt,
        postedAt: toIsoTimestamp(o.posted_at),
      });
    });

    if (errors.length > 0) {
      response.status(400);
      return { errors };
    }

    const values: unknown[] = [];
    const placeholders: string[] = [];

    observations.forEach((o: ObservationInput, i: number) => {
      const { observedAt, postedAt } = normalizedTimestamps[i];
      const base = i * INSERT_COLUMNS;
      placeholders.push(
        `($${base + 1}::TEXT, $${base + 2}::TEXT, $${base + 3}::TEXT, ` +
          `$${base + 4}::TEXT, $${base + 5}::TEXT, ` +
          `$${base + 6}::TIMESTAMPTZ, $${base + 7}::TIMESTAMPTZ, ` +
          `$${base + 8}::JSONB, $${base + 9}::TEXT, $${base + 10}::INT, ` +
          `$${base + 11}::TEXT, $${base + 12}::FLOAT, $${base + 13}::TEXT, ` +
          `$${base + 14}::BOOLEAN, $${base + 15}::JSONB)`,
      );
      values.push(
        o.domain,
        o.source_ref,
        o.url ?? null,
        o.author ?? null,
        o.platform ?? null,
        observedAt,
        postedAt,
        o.location == null ? null : JSON.stringify(o.location),
        o.signal_kind,
        o.wait_minutes ?? null,
        o.wait_category ?? null,
        o.confidence,
        o.provider ?? null,
        o.relevant ?? null,
        JSON.stringify(o.description),
      );
    });

    // ON CONFLICT (source_ref, observed_at) DO NOTHING + RETURNING id gives
    // the exact set of rows actually inserted, so skipped = total - inserted
    // is unambiguous (idempotent re-loads are the normal case for feedflag).
    const sql = `
      INSERT INTO "feed_observations"
        ("domain", "source_ref", "url", "author", "platform",
         "observed_at", "posted_at", "location", "signal_kind",
         "wait_minutes", "wait_category", "confidence", "provider",
         "relevant", "description")
      VALUES
        ${placeholders.join(",\n        ")}
      ON CONFLICT ("source_ref", "observed_at") DO NOTHING
      RETURNING id`;

    const insertedRows: unknown[] = await AppDataSource.manager.query(
      sql,
      values,
    );
    const inserted = insertedRows.length;
    const skipped = observations.length - inserted;

    return { inserted, skipped };
  }

  async index(request: Request, response: Response, _next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    const limit = Number(request.query.limit || 100);
    const take = limit < 100 ? limit : 100;
    const skip = Number(request.query.page || 0) * limit;

    const [observations, count] = await FeedObservation.findAndCount({
      take,
      skip,
      order: { createdAt: "DESC" },
    });

    return {
      results: observations.map((o) => o.asJSON()),
      count,
    };
  }

  /**
   * GET /feed-observations/summary — windowed aggregate over the table.
   *
   * Serves the daily findings digest (feedflag #69: the digest must read the
   * system of record, not data/observations.jsonl, which the runner empties
   * after every successful emit) and any future consumer that wants "what
   * happened in the last N hours" without paging the whole table.
   *
   * Contract notes, so nobody re-derives them from the digest's old JSONL
   * behaviour:
   *  - `since` is INCLUSIVE of the lower bound; the caller passes a boundary,
   *    not a duration, so clock skew between boxes cannot widen the window.
   *  - Every count is over DISTINCT (domain, source_ref) pairs, not rows —
   *    including the per-domain breakdown and by_signal_kind, so the three
   *    domain counts sum to total_observations exactly as the digest's
   *    dedupe-by-pair loop produced. feedflag may legitimately insert
   *    multiple rows per source_ref (one per observed_at); crowd_relevant_count
   *    counts rows, since each crowd row is a distinct ground-truth report.
   *  - `flagged` mirrors feedflag's shouldFlag exactly: social domain, relevant,
   *    confidence >= min_confidence, and signal_kind IN flag_categories when
   *    that list is non-empty. The threshold and category list are the
   *    CALLER's policy — the digest reads them from config/feeds.json +
   *    FLAG_CONFIDENCE, and this endpoint must not invent its own.
   *  - `hot_govt` counts distinct govt sources whose latest reading in the
   *    window is >= hot_wait_minutes (default 60 — the dispatch-relevant
   *    signal, MIN_POST_MINUTES in feedflag's notify/format.ts).
   *  - No caption, author, or description text is returned. This is an
   *    aggregate endpoint; the flagged table is for the digest, which already
   *    renders the human text from its own feed (the post URL links out).
   */
  async summary(request: Request, response: Response, _next: NextFunction) {
    if (!(await checkAuthorization(request))) {
      response.status(401);
      return { errors: ["Not authorized"] };
    }

    // since — ISO timestamp (or epoch millis); default now - 24h. The digest
    // passes an explicit boundary; anything older is rejected as 400 rather
    // than silently clamped, so a typo'd timestamp cannot make a "26h"
    // digest quietly read a month.
    const now = Date.now();
    let sinceMs: number | null;
    const sinceRaw = request.query.since;
    if (sinceRaw == null || sinceRaw === "") {
      sinceMs = now - 24 * 3600 * 1000;
    } else {
      const iso = toIsoTimestamp(sinceRaw);
      sinceMs = iso == null ? null : new Date(iso).getTime();
      if (sinceMs == null || sinceMs > now) {
        response.status(400);
        return {
          errors: [
            "since must be an ISO timestamp in the past (or omitted for the last 24h)",
          ],
        };
      }
    }

    // min_confidence — the caller's flag threshold (feedflag: FLAG_CONFIDENCE,
    // default 0.7). Clamped to [0,1]; anything else is a 400, not a silent 0.7.
    const minConfRaw = request.query.min_confidence;
    let minConfidence = 0.7;
    if (minConfRaw != null && minConfRaw !== "") {
      const n = Number(minConfRaw);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        response.status(400);
        return { errors: ["min_confidence must be a number in [0,1]"] };
      }
      minConfidence = n;
    }

    // flag_categories — the caller's flagCategories list. Comma-separated in
    // the query string, matching slackFlagChannels' shape. `flag_categories=`
    // (explicitly empty) means "no filter", NOT "no flags": feedflag's
    // absent-flagCategories semantic is "all categories".
    const flagCategories =
      typeof request.query.flag_categories === "string" &&
      request.query.flag_categories !== ""
        ? request.query.flag_categories
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean)
        : null;

    // hot_wait_minutes — dispatch-relevant govt wait threshold. Default 60.
    const hotRaw = request.query.hot_wait_minutes;
    let hotWaitMinutes = 60;
    if (hotRaw != null && hotRaw !== "") {
      const n = Number(hotRaw);
      if (!Number.isFinite(n) || n < 0) {
        response.status(400);
        return { errors: ["hot_wait_minutes must be a non-negative number"] };
      }
      hotWaitMinutes = n;
    }

    // One parameterized statement, three CTEs over one scan of the window:
    //   window  — the rows in the interval
    //   flagged — the digest's flag rule applied to the social rows
    //   govt   — per-source latest reading for the hot-count
    // Everything the digest needs, in one round-trip, with no string
    // interpolation of user input anywhere.
    const sinceIso = new Date(sinceMs).toISOString();
    const params: unknown[] = [sinceIso];
    let categoriesClause = "";
    if (flagCategories) {
      params.push(flagCategories);
      categoriesClause = `AND w.signal_kind = ANY($${params.length}::TEXT[])`;
    }
    params.push(minConfidence);
    const minConfParam = `$${params.length}`;
    params.push(hotWaitMinutes);
    const hotParam = `$${params.length}`;

    const sql = `
      WITH w AS (
        SELECT * FROM feed_observations WHERE observed_at >= $1::TIMESTAMPTZ
      ),
      flagged AS (
        SELECT DISTINCT ON (source_ref)
          source_ref, signal_kind, confidence, url, platform, observed_at
        FROM w
        WHERE domain = 'social'
          AND COALESCE(relevant, false)
          AND confidence >= ${minConfParam}::FLOAT
          ${categoriesClause}
        ORDER BY source_ref, observed_at DESC
      ),
      govt AS (
        SELECT DISTINCT ON (source_ref)
          source_ref, wait_minutes, author, observed_at
        FROM w
        WHERE domain = 'govt'
        ORDER BY source_ref, observed_at DESC
      )
      SELECT
        (SELECT COUNT(DISTINCT (domain, source_ref)) FROM w)  AS total_observations,
        (SELECT COUNT(DISTINCT source_ref) FROM w WHERE domain = 'govt')   AS govt_rows,
        (SELECT COUNT(DISTINCT source_ref) FROM w WHERE domain = 'social') AS social_rows,
        (SELECT COUNT(DISTINCT source_ref) FROM w WHERE domain = 'crowd')   AS crowd_rows,
        (SELECT COUNT(*) FROM flagged)                        AS flagged_count,
        (SELECT COUNT(*) FROM govt WHERE wait_minutes >= ${hotParam}::INT)
                                                               AS hot_govt_count,
        (SELECT COUNT(DISTINCT author) FROM govt)              AS govt_source_count,
        (SELECT COUNT(*) FROM w WHERE domain = 'crowd' AND COALESCE(relevant, false))
                                                               AS crowd_relevant_count,
        COALESCE((
          SELECT json_agg(k ORDER BY count DESC)
          FROM (
            SELECT signal_kind AS kind, COUNT(DISTINCT source_ref) AS count
            FROM w GROUP BY signal_kind
          ) k
        ), '[]'::json)                                          AS by_signal_kind,
        COALESCE((
          SELECT json_agg(f ORDER BY f.observed_at DESC)
          FROM (
            SELECT source_ref, signal_kind, confidence, url, platform, observed_at
            FROM flagged
            ORDER BY observed_at DESC
            LIMIT 50
          ) f
        ), '[]'::json)                                          AS flagged_recent
    `;

    const rows: Record<string, unknown>[] = await AppDataSource.manager.query(
      sql,
      params,
    );
    const r = rows[0] ?? {};

    const toInt = (v: unknown): number => (v == null ? 0 : Number(v));

    return {
      since: sinceIso,
      total_observations: toInt(r.total_observations),
      govt_rows: toInt(r.govt_rows),
      social_rows: toInt(r.social_rows),
      crowd_rows: toInt(r.crowd_rows),
      flagged_count: toInt(r.flagged_count),
      hot_govt_count: toInt(r.hot_govt_count),
      govt_source_count: toInt(r.govt_source_count),
      crowd_relevant_count: toInt(r.crowd_relevant_count),
      by_signal_kind: jsonColumn(r.by_signal_kind),
      flagged_recent: jsonColumn(r.flagged_recent),
    };
  }
}
