import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCountyToLocations1862600000000 implements MigrationInterface {
  name = "AddCountyToLocations1862600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "locations" ADD COLUMN "county" character varying
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_locations_county" ON "locations" ("county")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_locations_county"`);
    await queryRunner.query(
      `ALTER TABLE "locations" DROP COLUMN IF EXISTS "county"`,
    );
  }
}
