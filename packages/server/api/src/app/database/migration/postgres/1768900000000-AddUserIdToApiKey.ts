import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddUserIdToApiKey1768900000000 implements MigrationInterface {
    name = 'AddUserIdToApiKey1768900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "api_key"
            ADD "userId" character varying
        `)
        await queryRunner.query(`
            ALTER TABLE "api_key"
            ADD CONSTRAINT "fk_api_key_user_id" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "api_key" DROP CONSTRAINT "fk_api_key_user_id"
        `)
        await queryRunner.query(`
            ALTER TABLE "api_key" DROP COLUMN "userId"
        `)
    }
}
