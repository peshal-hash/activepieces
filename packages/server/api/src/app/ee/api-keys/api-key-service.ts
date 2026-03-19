import {
    ApiKey,
    ApiKeyResponseWithValue,
} from '@activepieces/ee-shared'
import { cryptoUtils } from '@activepieces/server-shared'
import {
    ActivepiecesError,
    apId,
    assertNotNullOrUndefined,
    ErrorCode,
    isNil,
    secureApId,
    SeekPage,
} from '@activepieces/shared'
import { FindOptionsWhere, IsNull } from 'typeorm'
import { repoFactory } from '../../core/db/repo-factory'
import { ApiKeyEntity } from './api-key-entity'

const API_KEY_TOKEN_LENGTH = 64
const repo = repoFactory<ApiKey>(ApiKeyEntity)

export const apiKeyService = {
    async add({
        platformId,
        userId,
        displayName,
    }: AddParams): Promise<ApiKeyResponseWithValue> {
        const generatedApiKey = generateApiKey()
        const savedApiKey = await repo().save({
            id: apId(),
            platformId,
            userId,
            displayName,
            hashedValue: generatedApiKey.secretHashed,
            truncatedValue: generatedApiKey.secretTruncated,
        })
        return {
            ...savedApiKey,
            value: generatedApiKey.secret,
        }
    },
    async getByValue(key: string): Promise<ApiKey | null> {
        assertNotNullOrUndefined(key, 'key')
        const apiKey = await repo().findOneBy({
            hashedValue: cryptoUtils.hashSHA256(key),
        })
        if (apiKey) {
            await repo().update(apiKey.id, {
                lastUsedAt: new Date().toISOString(),
            })
        }
        return apiKey
    },
    async list({ platformId, userId }: ListParams): Promise<SeekPage<ApiKey>> {
        const data = await repo().find({
            where: buildOwnerWhere({
                platformId,
                userId,
            }),
            order: {
                created: 'DESC',
            },
        })

        return {
            data,
            next: null,
            previous: null,
        }
    },
    async delete({ platformId, id, userId }: DeleteParams): Promise<void> {
        const where: FindOptionsWhere<ApiKey> = {
            id,
            ...buildOwnerWhere({
                platformId,
                userId,
            }),
        }
        const apiKey = await repo().findOneBy(where)
        if (isNil(apiKey)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    message: `api key with id ${id} not found`,
                },
            })
        }
        await repo().delete(where)
    },
}

export function generateApiKey() {
    const secretValue = secureApId(API_KEY_TOKEN_LENGTH - 3)
    const secretKey = `sk-${secretValue}`
    return {
        secret: secretKey,
        secretHashed: cryptoUtils.hashSHA256(secretKey),
        secretTruncated: secretKey.slice(-4),
    }
}

type AddParams = {
    platformId: string
    userId?: string
    displayName: string
}

type DeleteParams = {
    id: string
    platformId: string
    userId?: string
}

type ListParams = {
    platformId?: string
    userId?: string
}

function buildOwnerWhere({
    platformId,
    userId,
}: {
    platformId?: string
    userId?: string
}): FindOptionsWhere<ApiKey> {
    return {
        ...(platformId ? { platformId } : {}),
        userId: isNil(userId) ? IsNull() : userId,
    }
}
