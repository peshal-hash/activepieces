import { PlatformRole, PrincipalType } from '@activepieces/shared'
import { faker } from '@faker-js/faker'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { initializeDatabase } from '../../../../src/app/database'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { setupServer } from '../../../../src/app/server'
import { generateMockToken } from '../../../helpers/auth'
import {
    createMockApiKey,
    mockAndSaveBasicSetup,
    mockBasicUser,
} from '../../../helpers/mocks'

let app: FastifyInstance | null = null

beforeAll(async () => {
    await initializeDatabase({ runMigrations: false })
    app = await setupServer()
})

afterAll(async () => {
    await databaseConnection().destroy()
    await app?.close()
})

describe('API Key API', () => {
    describe('Create API Key API', () => {
        it('should create a new API Key', async () => {
            const { mockOwner, mockPlatform } = await mockAndSaveBasicSetup()

            const testToken = await generateMockToken({
                type: PrincipalType.USER,
                id: mockOwner.id,

                platform: { id: mockPlatform.id },
            })

            const mockApiKeyName = faker.lorem.word()
            const response = await app?.inject({
                method: 'POST',
                url: '/v1/api-keys',
                body: {
                    displayName: mockApiKeyName,
                },
                headers: {
                    authorization: `Bearer ${testToken}`,
                },
            })

            // assert
            const responseBody = response?.json()

            expect(response?.statusCode).toBe(StatusCodes.CREATED)
            expect(responseBody.id).toHaveLength(21)
            expect(responseBody.platformId).toBe(mockPlatform.id)
            expect(responseBody.hashedValue).toBeUndefined()
            expect(responseBody.displayName).toBe(mockApiKeyName)
            expect(responseBody.truncatedValue).toHaveLength(4)
            expect(responseBody.value).toHaveLength(64)
            expect(responseBody.value).toContain('sk-')
        })

    })

    describe('Delete API Key endpoint', () => {
        it('Fail if non owner', async () => {
            const { mockPlatform } = await mockAndSaveBasicSetup()
            const { mockUser } = await mockBasicUser({
                user: {
                    platformId: mockPlatform.id,
                    platformRole: PlatformRole.MEMBER,
                },
            })
            const mockApiKey = createMockApiKey({
                platformId: mockPlatform.id,
            })

            await databaseConnection().getRepository('api_key').save(mockApiKey)

            const testToken = await generateMockToken({
                type: PrincipalType.USER,
                id: mockUser.id,
                
                platform: { id: mockPlatform.id },
            })

            const response = await app?.inject({
                method: 'DELETE',
                url: `/v1/api-keys/${mockApiKey.id}`,
                headers: {
                    authorization: `Bearer ${testToken}`,
                },
            })

            expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
        })
    })

    describe('List API Keys endpoint', () => {
        it('Filters Signing Keys by platform', async () => {
            // arrange
            const { mockOwner: mockUserOne, mockPlatform: mockPlatformOne } = await mockAndSaveBasicSetup()
            const { mockPlatform: mockPlatformTwo } = await mockAndSaveBasicSetup()
            const { mockUser: mockPlatformOneMember } = await mockBasicUser({
                user: {
                    platformId: mockPlatformOne.id,
                },
            })


            const mockKeyOne = createMockApiKey({
                platformId: mockPlatformOne.id,
            })

            const mockKeyTwo = createMockApiKey({
                platformId: mockPlatformTwo.id,
            })

            const mockUserOwnedKey = createMockApiKey({
                platformId: mockPlatformOne.id,
                userId: mockPlatformOneMember.id,
            })

            await databaseConnection()
                .getRepository('api_key')
                .save([mockKeyOne, mockKeyTwo, mockUserOwnedKey])

            const testToken = await generateMockToken({
                type: PrincipalType.USER,
                id: mockUserOne.id,
                platform: { id: mockPlatformOne.id },
            })
            // act
            const response = await app?.inject({
                method: 'GET',
                url: '/v1/api-keys',
                headers: {
                    authorization: `Bearer ${testToken}`,
                },
            })

            // assert
            const responseBody = response?.json()
            expect(response?.statusCode).toBe(StatusCodes.OK)
            expect(responseBody.data).toHaveLength(1)
            expect(responseBody.data[0].id).toBe(mockKeyOne.id)
            expect(responseBody.data[0].hashedValue).toBeUndefined()
        })
    })

    describe('Personal API Key endpoints', () => {
        it('should create a user-owned API key for the current user', async () => {
            const { mockPlatform } = await mockAndSaveBasicSetup()
            const { mockUser } = await mockBasicUser({
                user: {
                    platformId: mockPlatform.id,
                    platformRole: PlatformRole.MEMBER,
                },
            })

            const testToken = await generateMockToken({
                type: PrincipalType.USER,
                id: mockUser.id,
                platform: { id: mockPlatform.id },
            })

            const response = await app?.inject({
                method: 'POST',
                url: '/v1/users/me/api-keys',
                body: {
                    displayName: 'personal-key',
                },
                headers: {
                    authorization: `Bearer ${testToken}`,
                },
            })

            const responseBody = response?.json()

            expect(response?.statusCode).toBe(StatusCodes.CREATED)
            expect(responseBody.platformId).toBe(mockPlatform.id)
            expect(responseBody.userId).toBe(mockUser.id)
            expect(responseBody.value).toContain('sk-')
        })

        it('should list only the current user personal API keys', async () => {
            const { mockPlatform } = await mockAndSaveBasicSetup()
            const { mockUser } = await mockBasicUser({
                user: {
                    platformId: mockPlatform.id,
                    platformRole: PlatformRole.MEMBER,
                },
            })
            const { mockUser: anotherUser } = await mockBasicUser({
                user: {
                    platformId: mockPlatform.id,
                    platformRole: PlatformRole.MEMBER,
                },
            })

            const ownApiKey = createMockApiKey({
                platformId: mockPlatform.id,
                userId: mockUser.id,
            })
            const anotherUsersApiKey = createMockApiKey({
                platformId: mockPlatform.id,
                userId: anotherUser.id,
            })
            const platformApiKey = createMockApiKey({
                platformId: mockPlatform.id,
            })

            await databaseConnection()
                .getRepository('api_key')
                .save([ownApiKey, anotherUsersApiKey, platformApiKey])

            const testToken = await generateMockToken({
                type: PrincipalType.USER,
                id: mockUser.id,
                platform: { id: mockPlatform.id },
            })

            const response = await app?.inject({
                method: 'GET',
                url: '/v1/users/me/api-keys',
                headers: {
                    authorization: `Bearer ${testToken}`,
                },
            })

            const responseBody = response?.json()

            expect(response?.statusCode).toBe(StatusCodes.OK)
            expect(responseBody.data).toHaveLength(1)
            expect(responseBody.data[0].id).toBe(ownApiKey.id)
        })

        it('should delete only the current user personal API key', async () => {
            const { mockPlatform } = await mockAndSaveBasicSetup()
            const { mockUser } = await mockBasicUser({
                user: {
                    platformId: mockPlatform.id,
                    platformRole: PlatformRole.MEMBER,
                },
            })

            const ownApiKey = createMockApiKey({
                platformId: mockPlatform.id,
                userId: mockUser.id,
            })

            await databaseConnection().getRepository('api_key').save(ownApiKey)

            const testToken = await generateMockToken({
                type: PrincipalType.USER,
                id: mockUser.id,
                platform: { id: mockPlatform.id },
            })

            const response = await app?.inject({
                method: 'DELETE',
                url: `/v1/users/me/api-keys/${ownApiKey.id}`,
                headers: {
                    authorization: `Bearer ${testToken}`,
                },
            })

            const deletedApiKey = await databaseConnection()
                .getRepository('api_key')
                .findOneBy({ id: ownApiKey.id })

            expect(response?.statusCode).toBe(StatusCodes.OK)
            expect(deletedApiKey).toBeNull()
        })
    })
})
