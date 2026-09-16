import { securityAccess } from '@activepieces/server-shared'
import { ActivepiecesError, AnalyticsReportRequest, ErrorCode, LeaderboardRequest, PlatformRole, PrincipalType, UserIdentityProvider } from '@activepieces/shared'
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { FastifyBaseLogger } from 'fastify'
import { userIdentityService } from '../authentication/user-identity/user-identity-service'
import { platformMustHaveFeatureEnabled } from '../ee/authentication/ee-authorization'
import { userService } from '../user/user-service'
import { piecesAnalyticsService } from './pieces-analytics.service'
import { platformAnalyticsReportService } from './platform-analytics-report.service'

export const platformAnalyticsModule: FastifyPluginAsyncTypebox = async (app) => {
    app.addHook('preHandler', platformMustHaveFeatureEnabled((platform) => platform.plan.analyticsEnabled))
    await piecesAnalyticsService(app.log).init()
    await app.register(platformAnalyticsController, { prefix: '/v1/analytics' })
}

const platformAnalyticsController: FastifyPluginAsyncTypebox = async (app) => {

    app.get('/', PlatformAnalyticsRequest, async (request) => {
        const { platform, id } = request.principal
        await assertUserIsNotEmbedded(id, request.log)
        const { timePeriod } = request.query
        return platformAnalyticsReportService(request.log).getOrGenerateReport(platform.id, timePeriod)
    })

    app.post('/refresh', RefreshPlatformAnalyticsRequest, async (request) => {
        const { platform, id } = request.principal
        await assertUserIsNotEmbedded(id, request.log)
        return platformAnalyticsReportService(request.log).refreshReport(platform.id)
    })

    app.get('/project-leaderboard', ProjectLeaderboardRequest, async (request) => {
        const { platform, id } = request.principal
        await assertUserIsNotEmbedded(id, request.log)
        const { timePeriod } = request.query
        return platformAnalyticsReportService(request.log).getProjectLeaderboard(platform.id, timePeriod)
    })

    app.get('/user-leaderboard', UserLeaderboardRequest, async (request) => {
        const { platform, id } = request.principal
        await assertUserIsNotEmbedded(id, request.log)
        const { timePeriod } = request.query
        return platformAnalyticsReportService(request.log).getUserLeaderboard(platform.id, timePeriod)
    })

    app.post('/mark-outdated', MarkAsOutdatedRequest, async (request) => {
        const { platform, id } = request.principal
        await assertUserIsNotEmbedded(id, request.log)
        await platformAnalyticsReportService(request.log).markAsOutdated(platform.id)
    })

}

async function assertUserIsNotEmbedded(userId: string, log: FastifyBaseLogger): Promise<void> {
    const user = await userService.getOneOrFail({ id: userId })
    // A platform admin is an operator of this platform, not a tenant embedded
    // inside it. The check below exists to stop an embedded end-user reading
    // platform-wide figures; it is not the authorization boundary, which is
    // securityAccess.publicPlatform on each route. Without this exemption a
    // JWT-provisioned admin is locked out of analytics on their own platform.
    if (user.platformRole === PlatformRole.ADMIN) {
        return
    }
    const userIdentity = await userIdentityService(log).getOneOrFail({ id: user.identityId })
    if (userIdentity.provider === UserIdentityProvider.JWT) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: { message: 'User is not allowed to access this resource' },
        })
    }
}

const RefreshPlatformAnalyticsRequest = {
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER]),
    },
}

const PlatformAnalyticsRequest = {
    schema: {
        querystring: AnalyticsReportRequest,
    },
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER]),
    },
}

const ProjectLeaderboardRequest = {
    schema: {
        querystring: LeaderboardRequest,
    },
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER]),
    },
}

const UserLeaderboardRequest = {
    schema: {
        querystring: LeaderboardRequest,
    },
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER]),
    },
}

const MarkAsOutdatedRequest = {
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER]),
    },
}