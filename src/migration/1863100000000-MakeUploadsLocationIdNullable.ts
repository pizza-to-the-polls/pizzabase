import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Orphan MMS media storage (issue #341): media from senders who don't match
 * a recent fulfilled report must be stored anyway (it surfaces in Slack
 * #feed-sms, Help Scout notes, and Retool) — but such media has no location.
 * uploads.location_id therefore becomes nullable; createFromMms links the
 * report's location only on the matched path.
 */
export class MakeUploadsLocationIdNullable1863100000000 implements MigrationInterface {
  name = "MakeUploadsLocationIdNullable1863100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Idempotent: only drop NOT NULL when the constraint is present.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'uploads'
            AND column_name = 'location_id'
            AND is_nullable = 'NO'
        ) THEN
          ALTER TABLE "uploads" ALTER COLUMN "location_id" DROP NOT NULL;
        END IF;
      END $$;
    `);

    // Retool interlock: re-assert the sealed retool_ro view (same columns —
    // location_id rides along and is simply nullable now; a SELECT-side
    // view needs no schema change). Idempotent; the grant is guarded so
    // fresh environments without the retool role still run clean.
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS retool_ro`);
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

  public async down(): Promise<void> {
    // No down migration: once orphan uploads exist (location_id IS NULL),
    // restoring NOT NULL would fail — and the orphan-storage feature
    // depends on the column staying nullable.
  }
}
