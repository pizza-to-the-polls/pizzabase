import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Remove the dead moderation_status column + enum (issue #357).
 *
 * Added 2026-09-17 by the async media-pipeline migration (1766200000000),
 * nothing ever wrote a non-'pending' value: no lambda, service or admin
 * endpoint sets 'clean'/'flagged'/'rejected' (SightEngine only writes
 * sightengine_score), and every row in the table was 'pending'. The
 * perpetual 'pending' value looked like an operational moderation queue
 * that does not exist — it confused humans and downstream Zaps. The
 * moderation_score column added by the same migration was also never
 * written; both are dropped here.
 *
 * The retool_ro.uploads view (1862900000000, re-asserted by later
 * migrations) selects moderation_status/moderation_score. Note: the view
 * must be DROPped and recreated — CREATE OR REPLACE VIEW cannot remove
 * or reorder columns (SQLState 42P16, caught by the staging deploy), it
 * can only append. The view is recreated without the moderation columns
 * first, inside the same migration, so there is no window where the view
 * is broken; the SELECT grant is re-attached after the recreate because
 * DROP VIEW drops it.
 */
export class RemoveModerationStatus1863400000000 implements MigrationInterface {
  name = "RemoveModerationStatus1863400000000";

  /**
   * Recreate retool_ro.uploads WITHOUT the moderation columns.
   * (Replaces the view: DROP + CREATE, not CREATE OR REPLACE — that
   * cannot drop columns. GRANT is re-attached because DROP VIEW drops it.)
   */
  private async recreateUploadsView(
    queryRunner: QueryRunner,
    withModerationColumns: boolean,
  ): Promise<void> {
    await queryRunner.query(`DROP VIEW IF EXISTS retool_ro.uploads`);
    const moderationColumns = withModerationColumns
      ? "moderation_status, moderation_score,"
      : "";
    await queryRunner.query(`
      CREATE VIEW retool_ro.uploads AS
      SELECT id, created_at, updated_at, file_path, location_id, report_id,
             media_status, ${moderationColumns}
             sightengine_score, processed_file_path, source,
             source_phone, message_sid
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

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Replace the view without the moderation columns (the view
    //    depends on them; the columns drop below, after the view no
    //    longer references them).
    await this.recreateUploadsView(queryRunner, false);

    // 2. Drop the moderation_score column (never written by any code path).
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP COLUMN "moderation_score"`,
    );

    // 3. Drop the moderation_status column.
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP COLUMN "moderation_status"`,
    );

    // 4. Drop the now-unused enum type.
    await queryRunner.query(`DROP TYPE "public"."moderation_status"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Restore the enum type.
    await queryRunner.query(
      `CREATE TYPE "public"."moderation_status" AS ENUM ('pending', 'clean', 'flagged', 'rejected')`,
    );

    // 2. Restore the moderation_status column (NOT NULL DEFAULT 'pending' —
    //    matches the state the column was in before this migration ran).
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "moderation_status" "moderation_status" NOT NULL DEFAULT 'pending'`,
    );

    // 3. Restore the moderation_score column.
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "moderation_score" double precision`,
    );

    // 4. Restore the retool_ro.uploads view WITH the moderation columns
    //    (recreate, for the same DROP-vs-OR-REPLACE reason as up()).
    await this.recreateUploadsView(queryRunner, true);
  }
}
