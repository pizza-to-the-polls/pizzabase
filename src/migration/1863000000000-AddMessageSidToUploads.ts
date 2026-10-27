import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMessageSidToUploads1863000000000 implements MigrationInterface {
  name = "AddMessageSidToUploads1863000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Idempotent: IF NOT EXISTS guard.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'uploads' AND column_name = 'message_sid'
        ) THEN
          ALTER TABLE "uploads" ADD COLUMN "message_sid" character varying(64) NULL;
        END IF;
      END $$;
    `);

    // Idempotent index.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_uploads_message_sid"
      ON "uploads" ("message_sid");
    `);

    // Retool interlock: expose uploads to the Retool role ONLY through a
    // sealed retool_ro view — the raw table carries the reporter's IP
    // address and unscrubbed EXIF data (GPS), which must never reach the
    // Retool role. The view carries what the Contact app needs to join
    // Twilio messages to their processed media per-message (message_sid,
    // added above) and to render media (processed_file_path holds the
    // full CDN URLs). Idempotent; the grant is guarded so fresh
    // environments without the retool role still run clean.
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The view references message_sid — drop it before the column.
    await queryRunner.query(`DROP VIEW IF EXISTS retool_ro.uploads`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_uploads_message_sid"`);
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP COLUMN IF EXISTS "message_sid"`,
    );
    // GRANTs are not revoked on down (no harm leaving SELECT on other
    // retool_ro objects; this view is gone).
  }
}
