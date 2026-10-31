import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Composite indexes on `actions` (Retool admin timeouts, 2026-10-31).
 *
 * The Retool Contact/digest queries filter `actions` by entity and by
 * action_type + time window. Both ride the baseline single-column indexes
 * (entity_id / entity_type / action_type), which works — but leaves work
 * on the heap:
 *
 * - "history for this location" (`entity_type = 'Location' AND entity_id =
 *   $1 [AND action_type = $2]`) scans the lone `entity_id` btree and
 *   re-checks entity_type/action_type against heap rows.
 * - "orders today per user" (`action_type = 'ordered' AND created_at >=
 *   CURRENT_DATE GROUP BY user_id`) bitmap-scans every 'ordered' row ever
 *   logged — 10.4k rows / 574 heap blocks at prod's 73k rows (23MB table) —
 *   then filters created_at in the heap. 60ms warm; on a cluster sized at
 *   Serverless v2 MinCapacity 0.5 ACU every one of those heap blocks is a
 *   potential cold EBS read, which is what the Retool timeouts were made of.
 *
 * These composites make both patterns index-driven:
 *
 * - (entity_type, entity_id) serves the entity-history lookup as a pure
 *   index cond, and covers entity_type-prefix queries generally.
 * - (action_type, created_at) INCLUDE (user_id) serves the per-user daily
 *   count entirely from the index as long as the query counts count(*)
 *   rather than count(id) — id is not in the INCLUDE payload.
 *
 * Plain CREATE INDEX, not CONCURRENTLY, same reasons as
 * AddFeedObservationsObservedAtIndex1863500000000: 73k rows builds in well
 * under a second, and migrations run inside TypeORM's global transaction.
 * The baseline single-column indexes stay for now — entity_type and
 * action_type (and eventually entity_id) are prefix-redundant with these,
 * but dropping them is a deliberate follow-up, not bundled here.
 */
export class AddActionsCompositeIndexes1863600000000 implements MigrationInterface {
  name = "AddActionsCompositeIndexes1863600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_actions_entity_type_entity_id"
         ON "actions" ("entity_type", "entity_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_actions_action_type_created_at"
         ON "actions" ("action_type", "created_at")
         INCLUDE ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_actions_action_type_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_actions_entity_type_entity_id"`,
    );
  }
}
