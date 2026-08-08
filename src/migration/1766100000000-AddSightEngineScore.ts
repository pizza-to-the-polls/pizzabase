import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSightEngineScore1766100000000 implements MigrationInterface {
  name = "AddSightEngineScore1766100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD COLUMN "sightengine_score" double precision NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP COLUMN "sightengine_score"`
    );
  }
}
