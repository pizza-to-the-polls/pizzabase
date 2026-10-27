import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMessageSidToUploads1862900000000 implements MigrationInterface {
  name = "AddMessageSidToUploads1862900000000";

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

    // Retool role: idempotent GRANT (only if the role exists).
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retool') THEN
          GRANT SELECT ON public.uploads TO retool;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_uploads_message_sid"`);
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP COLUMN IF EXISTS "message_sid"`,
    );
    // GRANTs are not revoked on down (no harm leaving SELECT).
  }
}
