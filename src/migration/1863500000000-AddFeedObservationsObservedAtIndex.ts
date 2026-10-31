import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Index feed_observations.observed_at (feedflag #69).
 *
 * GET /feed-observations/summary serves the daily findings digest with
 * `WHERE observed_at >= $1` over every count. The table's only index when
 * this lands is the unique (source_ref, observed_at) idempotency key, whose
 * leading column is source_ref — useless for a time-range predicate — so the
 * summary would sequential-scan a table that accumulates continuously (the
 * feedflag govt leg emits every 15 minutes; prod held 119k rows / 218MB in
 * its first eight days).
 *
 * Plain CREATE INDEX, deliberately NOT CONCURRENTLY: prod is small enough
 * that the build takes well under a second (119k rows), so the write lock is
 * momentary, and this repo runs migrations under TypeORM's global
 * "all" transaction mode — a per-migration `transaction = false` override is
 * forbidden (ForbiddenTransactionModeOverrideError, caught by the staging
 * deploy on the first attempt of this very migration), and Postgres cannot
 * run CREATE INDEX CONCURRENTLY inside a transaction anyway. If this table
 * ever reaches election-scale tens of millions of rows, revisit: switch to
 * CONCURRENTLY with migrationsTransactionMode "each" as a deliberate,
 * reviewed deploy-semantics change, not a quiet one.
 *
 * Idempotent by the migrations ledger (TypeORM records it as run); the
 * CREATE has no IF NOT EXISTS because a failed deploy re-runs the whole
 * transaction, so a partial index cannot exist.
 */
export class AddFeedObservationsObservedAtIndex1863500000000 implements MigrationInterface {
  name = "AddFeedObservationsObservedAtIndex1863500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_feed_observations_observed_at"
         ON "feed_observations" ("observed_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_feed_observations_observed_at"`,
    );
  }
}
