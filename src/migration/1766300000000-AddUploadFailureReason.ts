import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUploadFailureReason1766300000000 implements MigrationInterface {
  name = "AddUploadFailureReason1766300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "failure_reason" character varying NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP COLUMN "failure_reason"`,
    );
  }
}
