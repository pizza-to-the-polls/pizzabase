import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Retool PII sealing (applied manually 2026-10-24, promoted to a migration).
 *
 * The `retool` DB role has SELECT on 6 tables but two of them carry PII:
 * - `donations.email` (donor email)
 * - `reports.contact_info`, `reports.contact_first_name`, `reports.contact_last_name`
 *
 * Solution: a `retool_ro` schema with same-named views that exclude PII
 * columns, plus a role-level search_path redirect. Retool's existing queries
 * continue to work unchanged — they resolve to the views first.
 *
 * This migration is idempotent (CREATE OR REPLACE / IF NOT EXISTS).
 */
export class RetoolPiiViews1862900000000 implements MigrationInterface {
  name = "RetoolPiiViews1862900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS retool_ro`);

    // Donations without the donor email (domain survives for analytics)
    await queryRunner.query(`
      CREATE OR REPLACE VIEW retool_ro.donations AS
      SELECT id, created_at, updated_at, cancelled_at, amount_gross, amount,
             stripe_id, referrer, cancel_note, postal_code, url, gift,
             split_part(email, '@', 2) AS email_domain
      FROM public.donations
    `);

    // Reports without all contact columns
    await queryRunner.query(`
      CREATE OR REPLACE VIEW retool_ro.reports AS
      SELECT id, url, skipped_at, created_at, updated_at, location_id, order_id,
             truck_id, wait_time, can_distribute, contact_role, upload_id
      FROM public.reports
    `);

    // Seal the base tables from retool; grant the views
    await queryRunner.query(`REVOKE SELECT ON public.donations, public.reports FROM retool`);
    await queryRunner.query(`GRANT USAGE ON SCHEMA retool_ro TO retool`);
    await queryRunner.query(`GRANT SELECT ON retool_ro.donations, retool_ro.reports TO retool`);

    // Redirect unqualified table names for the retool role
    await queryRunner.query(`ALTER ROLE retool SET search_path = retool_ro, public`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER ROLE retool RESET search_path`);
    await queryRunner.query(`REVOKE SELECT ON retool_ro.donations, retool_ro.reports FROM retool`);
    await queryRunner.query(`REVOKE USAGE ON SCHEMA retool_ro FROM retool`);
    await queryRunner.query(`GRANT SELECT ON public.donations, public.reports TO retool`);
    await queryRunner.query(`DROP VIEW IF EXISTS retool_ro.donations, retool_ro.reports`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS retool_ro`);
  }
}
