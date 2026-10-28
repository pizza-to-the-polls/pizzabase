import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Issue #349 (BUG-021): announce-once guard for the feed/MMS Zapier hooks.
 *
 * zapNewUpload / zapNewMmsUpload previously had no persistence-backed guard,
 * so S3 ObjectCreated fan-out (at-least-once delivery) and browser PUT
 * retries produced duplicate feed posts. The guard is a DB compare-and-set
 * on uploads.zap_notified_at (NULL = unclaimed), enforced inside the zap
 * helpers themselves.
 *
 * Backfill: rows that are already media_status='ready' at migration time
 * have (almost certainly) already been announced by the pre-fix code — the
 * column is claimed for them so a deploy cannot retro-fire the zap for
 * every historical upload. Idempotent: re-running matches 0 rows.
 */
export class AddZapNotifiedAtToUploads1863200000000 implements MigrationInterface {
  name = "AddZapNotifiedAtToUploads1863200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Idempotent column add (matches AddMessageSidToUploads pattern).
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'uploads' AND column_name = 'zap_notified_at'
        ) THEN
          ALTER TABLE "uploads" ADD COLUMN "zap_notified_at" TIMESTAMP WITH TIME ZONE NULL;
        END IF;
      END $$;
    `);

    // Claim everything already ready at migration time so the new CAS guard
    // never announces historical uploads again on deploy.
    await queryRunner.query(`
      UPDATE "uploads" SET "zap_notified_at" = now()
      WHERE "media_status" = 'ready' AND "zap_notified_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP COLUMN IF EXISTS "zap_notified_at"`,
    );
  }
}
