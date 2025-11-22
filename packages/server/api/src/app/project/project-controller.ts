import { EndpointScope, PrincipalType, Project, UpdateProjectRequestInCommunity } from '@activepieces/shared'
import { FastifyPluginAsyncTypebox, Type } from '@fastify/type-provider-typebox'
import { StatusCodes } from 'http-status-codes'
import { paginationHelper } from '../helper/pagination/pagination-utils'
import { projectService } from './project-service'

export const userProjectController: FastifyPluginAsyncTypebox = async (fastify) => {
    fastify.get('/:id', async (request) => {
        return projectService.getOneOrThrow(request.principal.projectId)
    })

    fastify.get('/', async (request) => {
        return paginationHelper.createPage(
            [await projectService.getUserProjectOrThrow(request.principal.id)],
            null,
        )
    })
}

export const projectController: FastifyPluginAsyncTypebox = async (fastify) => {
    fastify.post('/:id', UpdateProjectRequest, async (request) => {
        return projectService.update(request.params.id, request.body)
    })

    // 🔴 NEW: hard delete a project by ID
    fastify.delete('/:id', DeleteProjectRequest, async (request, reply) => {
        await projectService.delete(request.params.id)
        return reply.status(StatusCodes.NO_CONTENT).send()
    })
}

const UpdateProjectRequest = {
    config: {
        allowedPrincipals: [PrincipalType.USER, PrincipalType.SERVICE],
        scope: EndpointScope.PLATFORM,
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
        allowedPrincipals: [PrincipalType.USER, PrincipalType.SERVICE],
        scope: EndpointScope.PLATFORM,
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
