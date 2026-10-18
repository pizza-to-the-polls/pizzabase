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
 * feedflag machine-token observation intake (FEAT-002d).
 *
 * POST /feed-observations — bulk insert of feedflag/observation@1 records,
 *   idempotent on (source_ref, observed_at) via ON CONFLICT DO NOTHING.
 * GET /feed-observations — paginated newest-first read-back so feedflag CI
 *   can verify its emit without DB credentials.
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

    const values: unknown[] = [];
    const placeholders: string[] = [];

    observations.forEach((o: ObservationInput, i: number) => {
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
        o.observed_at,
        o.posted_at ?? null,
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
}
