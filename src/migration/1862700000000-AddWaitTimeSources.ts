import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWaitTimeSources1862700000000 implements MigrationInterface {
  name = "AddWaitTimeSources1862700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."wait_time_scope" AS ENUM ('statewide', 'county', 'location')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."source_type" AS ENUM ('link', 'api', 'iframe')`,
    );

    await queryRunner.query(`
      CREATE TABLE "wait_time_sources" (
        "id" SERIAL PRIMARY KEY,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "scope" "wait_time_scope" NOT NULL,
        "state" CHAR(2) NOT NULL,
        "county" TEXT,
        "location_id" INTEGER,
        "url" TEXT NOT NULL,
        "source_type" "source_type" NOT NULL DEFAULT 'link',
        "display_label" TEXT,
        "notes" TEXT,
        "discovery_method" TEXT,
        "discovery_confidence" FLOAT,
        "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
        "last_verified_at" TIMESTAMP WITH TIME ZONE,
        "last_success_at" TIMESTAMP WITH TIME ZONE,
        "last_error_at" TIMESTAMP WITH TIME ZONE,
        "last_error_message" TEXT,
        CONSTRAINT "scope_fields" CHECK (
          (scope = 'statewide' AND county IS NULL AND location_id IS NULL) OR
          (scope = 'county' AND county IS NOT NULL AND location_id IS NULL) OR
          (scope = 'location' AND location_id IS NOT NULL)
        )
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_wait_time_sources_state" ON "wait_time_sources" ("state")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_wait_time_sources_is_active" ON "wait_time_sources" ("is_active")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_wait_time_sources_location_id" ON "wait_time_sources" ("location_id")`,
    );

    await queryRunner.query(`
      ALTER TABLE "wait_time_sources" ADD CONSTRAINT "FK_wait_time_sources_location_id"
      FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wait_time_sources" DROP CONSTRAINT IF EXISTS "FK_wait_time_sources_location_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wait_time_sources_location_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wait_time_sources_is_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_wait_time_sources_state"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "wait_time_sources"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."source_type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."wait_time_scope"`);
  }
}
