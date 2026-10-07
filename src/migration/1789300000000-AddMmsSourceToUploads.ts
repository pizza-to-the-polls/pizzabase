import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMmsSourceToUploads1789300000000 implements MigrationInterface {
  name = "AddMmsSourceToUploads1789300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."upload_source" AS ENUM ('web', 'mms')`,
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "source" "upload_source" NOT NULL DEFAULT 'web'`,
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "report_id" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD CONSTRAINT "FK_uploads_report_id" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_uploads_report_id" ON "uploads" ("report_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "source_phone" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "uploads" DROP COLUMN "source_phone"`);
    await queryRunner.query(`DROP INDEX "IDX_uploads_report_id"`);
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP CONSTRAINT "FK_uploads_report_id"`,
    );
    await queryRunner.query(`ALTER TABLE "uploads" DROP COLUMN "report_id"`);
    await queryRunner.query(`ALTER TABLE "uploads" DROP COLUMN "source"`);
    await queryRunner.query(`DROP TYPE "public"."upload_source"`);
  }
}
