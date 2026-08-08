import { MigrationInterface, QueryRunner } from "typeorm";

export class MediaPipeline1766003424000 implements MigrationInterface {
  name = "MediaPipeline1766003424000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum types
    await queryRunner.query(
      `CREATE TYPE "public"."uploads_media_status_enum" AS ENUM('none', 'processing', 'ready', 'failed')`
    );
    await queryRunner.query(
      `CREATE TYPE "public"."uploads_moderation_status_enum" AS ENUM('pending', 'clean', 'flagged', 'rejected')`
    );

    // Add new columns to uploads table
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD "raw_file_path" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD "media_status" "public"."uploads_media_status_enum" NOT NULL DEFAULT 'none'`
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD "processed_file_path" jsonb`
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD "exif_extracted" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD "exif_scrubbed" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(`ALTER TABLE "uploads" ADD "exif_data" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD "moderation_status" "public"."uploads_moderation_status_enum" NOT NULL DEFAULT 'pending'`
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD "moderation_score" double precision`
    );

    // Backfill raw_file_path from file_path for existing rows
    await queryRunner.query(
      `UPDATE "uploads" SET "raw_file_path" = "file_path" WHERE "raw_file_path" IS NULL`
    );

    // Backfill media_status to 'ready' for existing uploads (they were uploaded
    // before the pipeline existed and their files are already accessible)
    await queryRunner.query(
      `UPDATE "uploads" SET "media_status" = 'ready' WHERE "media_status" = 'none' AND "file_path" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP COLUMN "moderation_score"`
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP COLUMN "moderation_status"`
    );
    await queryRunner.query(`ALTER TABLE "uploads" DROP COLUMN "exif_data"`);
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP COLUMN "exif_scrubbed"`
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP COLUMN "exif_extracted"`
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP COLUMN "processed_file_path"`
    );
    await queryRunner.query(`ALTER TABLE "uploads" DROP COLUMN "media_status"`);
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP COLUMN "raw_file_path"`
    );

    await queryRunner.query(
      `DROP TYPE "public"."uploads_moderation_status_enum"`
    );
    await queryRunner.query(`DROP TYPE "public"."uploads_media_status_enum"`);
  }
}
