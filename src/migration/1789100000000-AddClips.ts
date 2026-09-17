import { MigrationInterface, QueryRunner } from "typeorm";

export class AddClips1789100000000 implements MigrationInterface {
  name = "AddClips1789100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."clip_status" AS ENUM ('queued', 'rendering', 'ready', 'approved', 'published', 'rejected')`,
    );

    await queryRunner.query(`
      CREATE TABLE "clips" (
        "id" SERIAL NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "upload_id" integer NOT NULL,
        "status" "clip_status" NOT NULL DEFAULT 'queued',
        "failure_reason" text,
        "output_paths" jsonb,
        "kit" jsonb,
        "publish_log" jsonb,
        "approved_by" character varying,
        "approved_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_clips" PRIMARY KEY ("id"),
        CONSTRAINT "FK_clips_upload_id" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_clips_upload_id" ON "clips" ("upload_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_clips_upload_id"`);
    await queryRunner.query(`DROP TABLE "clips"`);
    await queryRunner.query(`DROP TYPE "public"."clip_status"`);
  }
}
