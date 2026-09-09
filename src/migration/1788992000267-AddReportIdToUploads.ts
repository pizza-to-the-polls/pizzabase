import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReportIdToUploads1788992000267 implements MigrationInterface {
  name = "AddReportIdToUploads1788992000267";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "report_id" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD CONSTRAINT "FK_uploads_report_id" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_uploads_report_id" ON "uploads" ("report_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_uploads_report_id"`);
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP CONSTRAINT "FK_uploads_report_id"`,
    );
    await queryRunner.query(`ALTER TABLE "uploads" DROP COLUMN "report_id"`);
  }
}