import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBannedPhoneNumbers1766200000000 implements MigrationInterface {
  name = "AddBannedPhoneNumbers1766200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "banned_phone_numbers" ("id" SERIAL NOT NULL, "phone_number" character varying NOT NULL, "reason" text, "banned_by" character varying, "banned_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_phone_number" UNIQUE ("phone_number"), CONSTRAINT "PK_banned_phone_numbers" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_banned_phone_numbers_phone_number" ON "banned_phone_numbers" ("phone_number")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "banned_phone_numbers"`);
  }
}
