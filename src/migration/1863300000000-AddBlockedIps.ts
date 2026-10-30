import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBlockedIps1863300000000 implements MigrationInterface {
  name = "AddBlockedIps1863300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "blocked_ips" ("id" SERIAL NOT NULL, "ip_hash" character varying(64) NOT NULL, "reason" text, "blocked_by" character varying, "blocked_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_ip_hash" UNIQUE ("ip_hash"), CONSTRAINT "PK_blocked_ips" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_blocked_ips_ip_hash" ON "blocked_ips" ("ip_hash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "blocked_ips"`);
  }
}
