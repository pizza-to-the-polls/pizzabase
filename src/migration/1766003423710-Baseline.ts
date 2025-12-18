import { MigrationInterface, QueryRunner } from "typeorm";

export class Baseline1766003423710 implements MigrationInterface {
    name = 'Baseline1766003423710'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "actions" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "user_id" character varying NOT NULL, "entity_type" character varying NOT NULL, "entity_id" integer NOT NULL, "action_type" character varying NOT NULL, CONSTRAINT "PK_7bfb822f56be449c0b8adbf83cf" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_314aaf9c37b61b0a1267c1f4b5" ON "actions" ("user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_786d871710a4a3f67ff45baebb" ON "actions" ("entity_type") `);
        await queryRunner.query(`CREATE INDEX "IDX_f3c58ab86968b3b7e72b37c1a1" ON "actions" ("entity_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_839402b7086804741a9f1b6a61" ON "actions" ("action_type") `);
        await queryRunner.query(`CREATE TABLE "donations" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "cancelled_at" TIMESTAMP WITH TIME ZONE, "email" character varying NOT NULL, "amount_gross" double precision NOT NULL, "amount" double precision NOT NULL, "stripe_id" character varying NOT NULL, "referrer" character varying, "gift" character varying, "cancel_note" character varying, "postal_code" character varying, "url" character varying NOT NULL DEFAULT 'https://polls.pizza', CONSTRAINT "UQ_d6e5e0390697ea354a0806c4cec" UNIQUE ("stripe_id"), CONSTRAINT "PK_c01355d6f6f50fc6d1b4a946abf" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4a264e74ce3cf1b31541cc70e2" ON "donations" ("email") `);
        await queryRunner.query(`CREATE INDEX "IDX_d6e5e0390697ea354a0806c4ce" ON "donations" ("stripe_id") `);
        await queryRunner.query(`CREATE TABLE "orders" ("id" SERIAL NOT NULL, "cost" double precision NOT NULL, "snacks" integer NOT NULL, "order_type" character varying NOT NULL DEFAULT 'pizzas', "quantity" integer NOT NULL, "restaurant" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "cancelled_at" TIMESTAMP WITH TIME ZONE, "cancel_note" character varying, "location_id" integer NOT NULL, CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_66f913b9f4e9d0925924a19e3e" ON "orders" ("order_type") `);
        await queryRunner.query(`CREATE INDEX "IDX_ac68586aa4ddb7b88ee83b7d22" ON "orders" ("restaurant") `);
        await queryRunner.query(`CREATE INDEX "IDX_90e29013d1252e005e70beb4f4" ON "orders" ("location_id") `);
        await queryRunner.query(`CREATE TABLE "reports" ("id" SERIAL NOT NULL, "contact_info" character varying NOT NULL, "contact_first_name" character varying, "contact_last_name" character varying, "contact_role" character varying, "wait_time" character varying, "can_distribute" integer NOT NULL DEFAULT '0', "url" character varying NOT NULL, "skipped_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "location_id" integer NOT NULL, "order_id" integer, "truck_id" integer, CONSTRAINT "PK_d9013193989303580053c0b5ef6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4406212b6fa30283a9f70d4675" ON "reports" ("url") `);
        await queryRunner.query(`CREATE INDEX "IDX_1139cc88fcfc10ca98d5560e51" ON "reports" ("location_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_0bde03969e44aad71e5e28f66b" ON "reports" ("order_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_be5508fcc533a9f36c0899f178" ON "reports" ("truck_id") `);
        await queryRunner.query(`CREATE TABLE "trucks" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "identifier" character varying, "location_id" integer NOT NULL, CONSTRAINT "PK_6a134fb7caa4fb476d8a6e035f9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cffaf034d6bcc7178c22c67ddf" ON "trucks" ("location_id") `);
        await queryRunner.query(`CREATE TABLE "uploads" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "ip_address" character varying NOT NULL, "file_path" character varying NOT NULL, "file_hash" character varying, "location_id" integer NOT NULL, CONSTRAINT "UQ_9ed602b1baac56490745b14016e" UNIQUE ("file_path"), CONSTRAINT "UQ_5ed25e98679af5ac0848d6b9487" UNIQUE ("file_hash"), CONSTRAINT "PK_d1781d1eedd7459314f60f39bd3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_10ec645534410fe74e76cbd9d9" ON "uploads" ("location_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_b4c697d380719c7d653cf814d0" ON "uploads" ("ip_address") `);
        await queryRunner.query(`CREATE TABLE "locations" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "full_address" character varying NOT NULL, "lat" character varying NOT NULL, "lng" character varying NOT NULL, "address" character varying NOT NULL, "city" character varying NOT NULL, "state" character varying NOT NULL, "zip" character varying(5) NOT NULL, "validated_at" TIMESTAMP WITH TIME ZONE, "canonical_id" integer, CONSTRAINT "UQ_e350739a16c2b0d9857d9e027d0" UNIQUE ("full_address"), CONSTRAINT "PK_7cc1c9e3853b94816c094825e74" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e350739a16c2b0d9857d9e027d" ON "locations" ("full_address") `);
        await queryRunner.query(`CREATE INDEX "IDX_f1a9093eafe4afa3a5ee8ca096" ON "locations" ("city") `);
        await queryRunner.query(`CREATE INDEX "IDX_8d86e811a6eeb8a467fdbb0152" ON "locations" ("state") `);
        await queryRunner.query(`CREATE INDEX "IDX_54ba1494c2ba05027873130e2f" ON "locations" ("zip") `);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_90e29013d1252e005e70beb4f46" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reports" ADD CONSTRAINT "FK_1139cc88fcfc10ca98d5560e510" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reports" ADD CONSTRAINT "FK_0bde03969e44aad71e5e28f66be" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reports" ADD CONSTRAINT "FK_be5508fcc533a9f36c0899f178d" FOREIGN KEY ("truck_id") REFERENCES "trucks"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trucks" ADD CONSTRAINT "FK_cffaf034d6bcc7178c22c67ddfb" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "uploads" ADD CONSTRAINT "FK_10ec645534410fe74e76cbd9d98" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "locations" ADD CONSTRAINT "FK_5c27d8a4fc9bffd186878862cbb" FOREIGN KEY ("canonical_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "locations" DROP CONSTRAINT "FK_5c27d8a4fc9bffd186878862cbb"`);
        await queryRunner.query(`ALTER TABLE "uploads" DROP CONSTRAINT "FK_10ec645534410fe74e76cbd9d98"`);
        await queryRunner.query(`ALTER TABLE "trucks" DROP CONSTRAINT "FK_cffaf034d6bcc7178c22c67ddfb"`);
        await queryRunner.query(`ALTER TABLE "reports" DROP CONSTRAINT "FK_be5508fcc533a9f36c0899f178d"`);
        await queryRunner.query(`ALTER TABLE "reports" DROP CONSTRAINT "FK_0bde03969e44aad71e5e28f66be"`);
        await queryRunner.query(`ALTER TABLE "reports" DROP CONSTRAINT "FK_1139cc88fcfc10ca98d5560e510"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_90e29013d1252e005e70beb4f46"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_54ba1494c2ba05027873130e2f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8d86e811a6eeb8a467fdbb0152"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f1a9093eafe4afa3a5ee8ca096"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e350739a16c2b0d9857d9e027d"`);
        await queryRunner.query(`DROP TABLE "locations"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b4c697d380719c7d653cf814d0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_10ec645534410fe74e76cbd9d9"`);
        await queryRunner.query(`DROP TABLE "uploads"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cffaf034d6bcc7178c22c67ddf"`);
        await queryRunner.query(`DROP TABLE "trucks"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_be5508fcc533a9f36c0899f178"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0bde03969e44aad71e5e28f66b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1139cc88fcfc10ca98d5560e51"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4406212b6fa30283a9f70d4675"`);
        await queryRunner.query(`DROP TABLE "reports"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_90e29013d1252e005e70beb4f4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ac68586aa4ddb7b88ee83b7d22"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_66f913b9f4e9d0925924a19e3e"`);
        await queryRunner.query(`DROP TABLE "orders"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d6e5e0390697ea354a0806c4ce"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4a264e74ce3cf1b31541cc70e2"`);
        await queryRunner.query(`DROP TABLE "donations"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_839402b7086804741a9f1b6a61"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f3c58ab86968b3b7e72b37c1a1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_786d871710a4a3f67ff45baebb"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_314aaf9c37b61b0a1267c1f4b5"`);
        await queryRunner.query(`DROP TABLE "actions"`);
    }

}
