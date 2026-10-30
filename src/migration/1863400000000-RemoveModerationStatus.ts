import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Remove the dead `moderation_status` column + enum (issue #357).
 *
 * Added 2026-09-17 by the async media-pipeline migration (1766200000000),
 * nothing ever wrote a non-`pending` value: no lambda, service, or admin
 * endpoint sets `clean`/`flagged`/`rejected` (SightEngine only writes
 * `sightengine_score`). Every upload row has been `pending` since the
 * column existed, `pending` gates nothing, and the perpetual "pending"
 * value falsely reads as a moderation queue that does not exist — it has
 * confused humans (Pizza Eagle told a volunteer a live report was "in the
 * moderation queue") and agents alike.
 *
 * The companion `moderation_score` column (same migration) was also never
 * written — dead on arrival, dropped alongside.
 *
 * The retool_ro.uploads view is recreated first (without the moderation
 * columns) so the view never references a dropped column. Idempotent /
 * grant-guarded per the established retool_ro pattern.
 */
export class RemoveModerationStatus1863400000000 implements MigrationInterface {
  name = "RemoveModerationStatus1863400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Recreate retool_ro.uploads WITHOUT moderation columns first
    //    (the view depends on the columns; order matters).
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS retool_ro`);
    await queryRunner.query(`
      CREATE OR REPLACE VIEW retool_ro.uploads AS
      SELECT id, created_at, updated_at, file_path, location_id, report_id,
             media_status, sightengine_score, processed_file_path, source,
             source_phone, message_sid
      FROM public.uploads
    `);
    // Grant is guarded so fresh environments without the retool role still
    // run clean (same pattern as the prior retool_ro.uploads migrations).
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retool') THEN
          GRANT SELECT ON retool_ro.uploads TO retool;
        END IF;
      END $$;
    `);

    // 2. Drop the moderation_score column
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP COLUMN "moderation_score"`,
    );

    // 3. Drop the moderation_status column
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP COLUMN "moderation_status"`,
    );

    // 4. Drop the now-unused enum type
    await queryRunner.query(`DROP TYPE "public"."moderation_status"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Restore the enum type
    await queryRunner.query(
      `CREATE TYPE "public"."moderation_status" AS ENUM ('pending', 'clean', 'flagged', 'rejected')`,
    );

    // 2. Restore the moderation_status column
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "moderation_status" "moderation_status" NOT NULL DEFAULT 'pending'`,
    );

    // 3. Restore the moderation_score column
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "moderation_score" double precision`,
    );

    // 4. Restore the retool_ro.uploads view with moderation columns
    await queryRunner.query(`
      CREATE OR REPLACE VIEW retool_ro.uploads AS
      SELECT id, created_at, updated_at, file_path, location_id, report_id,
             media_status, moderation_status, moderation_score,
             sightengine_score, processed_file_path, source, source_phone,
             message_sid
      FROM public.uploads
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retool') THEN
          GRANT SELECT ON retool_ro.uploads TO retool;
        END IF;
      END $$;
    `);
  }
}
