import { ProjectResourceType, securityAccess } from '@activepieces/server-shared'
import { assertNotNullOrUndefined, PrincipalType, Project, UpdateProjectRequestInCommunity } from '@activepieces/shared'
import { FastifyPluginAsyncTypebox, Type } from '@fastify/type-provider-typebox'
import { StatusCodes } from 'http-status-codes'
import { paginationHelper } from '../helper/pagination/pagination-utils'
import { userService } from '../user/user-service'
import { projectService } from './project-service'


export const projectController: FastifyPluginAsyncTypebox = async (fastify) => {
    fastify.post('/:id', UpdateProjectRequest, async (request) => {
        const project = await projectService.getOneOrThrow(request.params.id)
        return projectService.update(request.params.id, {
            type: project.type,
            ...request.body,
        })
    })

    fastify.get('/:id', {
        config: {
            security: securityAccess.project([PrincipalType.USER], undefined, {
                type: ProjectResourceType.PARAM,
                paramKey: 'id',
            }),
        },
    }, async (request) => {
        return projectService.getOneOrThrow(request.projectId)
    })

    fastify.get('/', {
        config: {
            security: securityAccess.publicPlatform([PrincipalType.USER]),
        },
    }, async (request) => {
        const user = await userService.getOneOrFail({ id: request.principal.id })
        assertNotNullOrUndefined(user.platformId, 'platformId is undefined')
        const projects = await projectService.getAllForUser({
            platformId: user.platformId,
            userId: user.id,
            isPrivileged: userService.isUserPrivileged(user),
        })
        return paginationHelper.createPage(projects, null)
    })

    // 🔴 NEW: hard delete a project by ID
    fastify.delete('/:id', DeleteProjectRequest, async (request, reply) => {
        await projectService.delete(request.params.id)
        return reply.status(StatusCodes.NO_CONTENT).send()
    })
}

const UpdateProjectRequest = {
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        tags: ['projects'],
        params: Type.Object({
            id: Type.String(),
        }),
        response: {
            [StatusCodes.OK]: Project,
        },
        body: UpdateProjectRequestInCommunity,
    },
}

// 🔴 NEW: Delete request schema/config
const DeleteProjectRequest = {
    config: {
        security: securityAccess.publicPlatform([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        tags: ['projects'],
        params: Type.Object({
            id: Type.String(),
        }),
        // 204 has no body
        response: {
            [StatusCodes.NO_CONTENT]: Type.Null(),
        },
    },
}
