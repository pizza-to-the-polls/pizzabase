import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFeedObservations1862600000000 implements MigrationInterface {
  name = "AddFeedObservations1862600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // feedflag/observation@1 records (FEAT-002d). PII floor (design D6):
    // contact-info columns are forbidden here by design — `description`
    // JSONB holds only public caption / image-description text and
    // `author` is the public handle only.
    await queryRunner.query(`
      CREATE TABLE "feed_observations" (
        "id" SERIAL PRIMARY KEY,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "domain" TEXT NOT NULL,
        "source_ref" TEXT NOT NULL,
        "url" TEXT,
        "author" TEXT,
        "platform" TEXT,
        "observed_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "posted_at" TIMESTAMP WITH TIME ZONE,
        "location" JSONB,
        "signal_kind" TEXT NOT NULL,
        "wait_minutes" INT,
        "wait_category" TEXT,
        "confidence" FLOAT NOT NULL,
        "provider" TEXT,
        "relevant" BOOLEAN,
        "description" JSONB NOT NULL
      )
    `);

    // Unique composite index — the idempotency key for bulk loads.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_feed_observations_source_ref_observed_at"
      ON "feed_observations" ("source_ref", "observed_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_feed_observations_source_ref_observed_at"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "feed_observations"`);
  }
}
