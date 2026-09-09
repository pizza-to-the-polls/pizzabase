import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReportIdToUploads1788992000267 implements MigrationInterface {
  name = "AddReportIdToUploads1788992000267";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "api_keys" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "key" character varying NOT NULL, "description" character varying, CONSTRAINT "UQ_e42cf55faeafdcce01a82d24849" UNIQUE ("key"), CONSTRAINT "PK_5c8a79801b44bd27b79228e1dad" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e42cf55faeafdcce01a82d2484" ON "api_keys" ("key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "banned_phone_numbers" ("id" SERIAL NOT NULL, "phone_number" character varying NOT NULL, "reason" text, "banned_by" character varying, "banned_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_abc4c22abb52578a4a4edfcfdcd" UNIQUE ("phone_number"), CONSTRAINT "PK_3e9624bd2e0e89a49c67cf8240f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_abc4c22abb52578a4a4edfcfdc" ON "banned_phone_numbers" ("phone_number") `,
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD "sightengine_score" double precision`,
    );
    await queryRunner.query(`ALTER TABLE "uploads" ADD "report_id" integer`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_314aaf9c37b61b0a1267c1f4b5"`,
    );
    await queryRunner.query(`ALTER TABLE "actions" DROP COLUMN "user_id"`);
    await queryRunner.query(
      `ALTER TABLE "actions" ADD "user_id" text NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_314aaf9c37b61b0a1267c1f4b5" ON "actions" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cf80f4132f47a6aaae8d6ee93e" ON "uploads" ("report_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "uploads" ADD CONSTRAINT "FK_cf80f4132f47a6aaae8d6ee93eb" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP CONSTRAINT "FK_cf80f4132f47a6aaae8d6ee93eb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cf80f4132f47a6aaae8d6ee93e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_314aaf9c37b61b0a1267c1f4b5"`,
    );
    await queryRunner.query(`ALTER TABLE "actions" DROP COLUMN "user_id"`);
    await queryRunner.query(
      `ALTER TABLE "actions" ADD "user_id" character varying NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_314aaf9c37b61b0a1267c1f4b5" ON "actions" ("user_id") `,
    );
    await queryRunner.query(`ALTER TABLE "uploads" DROP COLUMN "report_id"`);
    await queryRunner.query(
      `ALTER TABLE "uploads" DROP COLUMN "sightengine_score"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_abc4c22abb52578a4a4edfcfdc"`,
    );
    await queryRunner.query(`DROP TABLE "banned_phone_numbers"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e42cf55faeafdcce01a82d2484"`,
    );
    await queryRunner.query(`DROP TABLE "api_keys"`);
  }
}
