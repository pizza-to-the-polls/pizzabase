import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLinks1862400000000 implements MigrationInterface {
  name = "AddLinks1862400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "links" (
        "id" SERIAL PRIMARY KEY,
        "slug" character varying NOT NULL,
        "target_url" character varying NOT NULL,
        "campaign_tag" character varying NOT NULL,
        "clip_id" integer,
        "created_at" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_links_slug" ON "links" ("slug")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_links_campaign_tag" ON "links" ("campaign_tag")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_links_clip_id" ON "links" ("clip_id")`,
    );

    // FK to clips table (created by AddClips migration)
    await queryRunner.query(`
      ALTER TABLE "links" ADD CONSTRAINT "FK_links_clip_id"
      FOREIGN KEY ("clip_id") REFERENCES "clips"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "link_clicks" (
        "id" SERIAL PRIMARY KEY,
        "link_id" integer NOT NULL,
        "user_agent" character varying,
        "referer" character varying,
        "clicked_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_link_clicks_link_id" ON "link_clicks" ("link_id")`,
    );

    await queryRunner.query(`
      ALTER TABLE "link_clicks" ADD CONSTRAINT "FK_link_clicks_link_id"
      FOREIGN KEY ("link_id") REFERENCES "links"("id") ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "link_clicks" DROP CONSTRAINT IF EXISTS "FK_link_clicks_link_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_link_clicks_link_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "link_clicks"`);
    await queryRunner.query(
      `ALTER TABLE "links" DROP CONSTRAINT IF EXISTS "FK_links_clip_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_links_clip_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_links_campaign_tag"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_links_slug"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "links"`);
  }
}
