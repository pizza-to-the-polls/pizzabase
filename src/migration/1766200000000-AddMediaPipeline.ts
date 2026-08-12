import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMediaPipeline1766200000000 implements MigrationInterface {
  name = "AddMediaPipeline1766200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum types first
    await queryRunner.query(
      `CREATE TYPE "public"."media_status" AS ENUM ('none', 'processing', 'ready', 'failed')`
    );
    await queryRunner.query(
      `CREATE TYPE "public"."moderation_status" AS ENUM ('pending', 'clean', 'flagged', 'rejected')`
    );

    // Add new columns
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "raw_file_path" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "media_status" "media_status" NOT NULL DEFAULT 'none'`
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "processed_file_path" jsonb`
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "exif_extracted" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "exif_scrubbed" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "exif_data" jsonb`
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "moderation_status" "moderation_status" NOT NULL DEFAULT 'pending'`
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "moderation_score" double precision`
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "raw_bucket" character varying NOT NULL DEFAULT 'raw.polls.pizza'`
    );

    // Backfill raw_file_path from existing file_path
    await queryRunner.query(
      `UPDATE "uploads" SET "raw_file_path" = "file_path"`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "uploads" DROP COLUMN "raw_bucket"`);
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

    await queryRunner.query(`DROP TYPE "public"."moderation_status"`);
    await queryRunner.query(`DROP TYPE "public"."media_status"`);
  }
}
