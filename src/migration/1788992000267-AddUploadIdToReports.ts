import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUploadIdToReports1788992000267 implements MigrationInterface {
  name = "AddUploadIdToReports1788992000267";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reports" ADD COLUMN "upload_id" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "reports" ADD CONSTRAINT "FK_reports_upload_id" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reports_upload_id" ON "reports" ("upload_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_reports_upload_id"`);
    await queryRunner.query(
      `ALTER TABLE "reports" DROP CONSTRAINT "FK_reports_upload_id"`,
    );
    await queryRunner.query(`ALTER TABLE "reports" DROP COLUMN "upload_id"`);
  }
}
