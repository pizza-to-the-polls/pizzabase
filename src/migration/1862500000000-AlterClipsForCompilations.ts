import { MigrationInterface, QueryRunner } from "typeorm";

export class AlterClipsForCompilations1862500000000 implements MigrationInterface {
  name = "AlterClipsForCompilations1862500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Scheduled compilations (compileClips lambda) join several rendered
    // clips and have no single source upload → upload_id becomes nullable.
    await queryRunner.query(
      `ALTER TABLE "clips" ALTER COLUMN "upload_id" DROP NOT NULL`,
    );

    // compiled_at marks clips already folded into a compilation; NULL means
    // the clip is new content for the next compile run.
    await queryRunner.query(
      `ALTER TABLE "clips" ADD COLUMN "compiled_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "clips" DROP COLUMN "compiled_at"`);
    // Clips with a null upload (compilations) must be deleted before this
    // constraint can return.
    await queryRunner.query(
      `ALTER TABLE "clips" ALTER COLUMN "upload_id" SET NOT NULL`,
    );
  }
}
