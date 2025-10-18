import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Make sure the class name and file name share the same timestamp suffix.
 * Example file: 1760724044072-CreateOtpTable.ts
 * Example class: CreateOtpTable1760724044072
 */
export class CreateOtpTable1760724044072 implements MigrationInterface {
  name = "CreateOtpTable1760724044072";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Create otp table with camelCase "identityId"
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "otp" (
        "id"          varchar(255) PRIMARY KEY,
        "created"     timestamptz NOT NULL DEFAULT now(),
        "updated"     timestamptz NOT NULL,
        "type"        varchar(64)  NOT NULL,
        "identityId"  varchar(255) NOT NULL,
        "value"       varchar(64)  NOT NULL,
        "state"       varchar(32)  NOT NULL
      )
    `);

    // 2) Unique index on ("identityId","type")
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_otp_identityId_type"
      ON "otp" ("identityId","type")
    `);

    // 3) FK to user_identity(id) with CASCADE
    // Postgres doesn't support IF NOT EXISTS for constraints—wrap in an anonymous block
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          WHERE c.conname = 'fk_otp_identityId' AND t.relname = 'otp'
        ) THEN
          ALTER TABLE "otp"
            ADD CONSTRAINT "fk_otp_identityId"
            FOREIGN KEY ("identityId") REFERENCES "user_identity"("id")
            ON DELETE CASCADE;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop FK (guarded)
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          WHERE c.conname = 'fk_otp_identityId' AND t.relname = 'otp'
        ) THEN
          ALTER TABLE "otp" DROP CONSTRAINT "fk_otp_identityId";
        END IF;
      END $$;
    `);

    // Drop index and table
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_otp_identityId_type"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "otp"`);
  }
}
