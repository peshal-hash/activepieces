import { ApiKey } from '@activepieces/ee-shared'
import { Platform, User } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import {
    ApIdSchema,
    BaseColumnSchemaPart,
} from '../../database/database-common'

type ApiKeySchema = ApiKey & {
    platform: Platform
    user?: User
}

export const ApiKeyEntity = new EntitySchema<ApiKeySchema>({
    name: 'api_key',
    columns: {
        ...BaseColumnSchemaPart,
        displayName: {
            type: String,
            nullable: false,
        },
        platformId: {
            ...ApIdSchema,
            nullable: false,
        },
        userId: {
            ...ApIdSchema,
            nullable: true,
        },
        hashedValue: {
            type: String,
            nullable: false,
        },
        truncatedValue: {
            type: String,
            nullable: false,
        },
        lastUsedAt: {
            type: String,
            nullable: true,
        },
    },
    indices: [],
    relations: {
        platform: {
            type: 'many-to-one',
            target: 'platform',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'platformId',
                referencedColumnName: 'id',
                foreignKeyConstraintName: 'fk_api_key_platform_id',
            },
        },
        user: {
            type: 'many-to-one',
            target: 'user',
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'userId',
                referencedColumnName: 'id',
                foreignKeyConstraintName: 'fk_api_key_user_id',
            },
        },
    },
})
