import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUsersAndTrustedBy1863700000000 implements MigrationInterface {
  name = "AddUsersAndTrustedBy1863700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Users: known trusted people. Populated normally via the API-key
    // protected CRUD endpoints (UsersController) so Pizza Eagle can add
    // users on request; the seed rows below carry over the staging
    // allowlist that was hardcoded in src/lib/partners.ts (PARTNER_EMAILS)
    // so existing partner sessions keep working.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" SERIAL NOT NULL PRIMARY KEY,
        "email" character varying NOT NULL UNIQUE,
        "first_name" character varying,
        "organization" character varying,
        "admin" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      INSERT INTO "users" ("email", "first_name", "organization", "admin")
      VALUES
        ('scott@polls.pizza', 'Scott', 'Pizza to the Polls', true),
        ('nina@polls.pizza', 'Nina', 'Pizza to the Polls', true),
        ('lee.kornfeld@gmail.com', 'Lee', 'Pizza to the Polls', true)
      ON CONFLICT ("email") DO NOTHING
    `);

    // Who validated/submitted each trusted report. Nullable: public and
    // legacy reports have no trusted submitter, and ON DELETE SET NULL so
    // removing a user nulls their attribution instead of failing.
    await queryRunner.query(`
      ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "trusted_by" integer
      REFERENCES "users"("id") ON DELETE SET NULL
    `);

    // Retool / audit queries: all reports validated by a given user.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_reports_trusted_by"
      ON "reports" ("trusted_by")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_reports_trusted_by"
    `);
    await queryRunner.query(`
      ALTER TABLE "reports" DROP COLUMN IF EXISTS "trusted_by"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
