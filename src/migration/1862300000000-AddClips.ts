import { MigrationInterface, QueryRunner } from "typeorm";

export class AddClips1862300000000 implements MigrationInterface {
  name = "AddClips1862300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create clip_status enum type
    await queryRunner.query(
      `CREATE TYPE "public"."clip_status" AS ENUM ('queued', 'rendering', 'ready', 'approved', 'published', 'rejected')`,
    );

    // Create clips table
    await queryRunner.query(
      `CREATE TABLE "clips" (
        "id" SERIAL PRIMARY KEY,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "upload_id" integer NOT NULL,
        "status" "clip_status" NOT NULL DEFAULT 'queued',
        "failure_reason" character varying,
        "output_paths" jsonb,
        "kit" jsonb,
        "publish_log" jsonb,
        "approved_by" character varying,
        "approved_at" timestamp with time zone
      )`,
    );

    // Indexes
    await queryRunner.query(
      `CREATE INDEX "IDX_clips_upload_id" ON "clips" ("upload_id")`,
    );

    // Foreign key constraint
    await queryRunner.query(
      `ALTER TABLE "clips" ADD CONSTRAINT "FK_clips_upload_id"
       FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "clips" DROP CONSTRAINT IF EXISTS "FK_clips_upload_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_clips_upload_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "clips"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."clip_status"`);
  }
}
