import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIntegrationSessions1766200000000 implements MigrationInterface {
  name = "AddIntegrationSessions1766200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "integration_sessions" (
        "service" character varying NOT NULL,
        "credentials" text NOT NULL,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_sessions" PRIMARY KEY ("service")
      )`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "integration_sessions"`);
  }
}
