import { EntitySourceType, ProjectResourceType, securityAccess } from '@activepieces/server-shared'
import { CreateFieldRequest, Field, ListFieldsRequestQuery, PrincipalType, UpdateFieldRequest } from '@activepieces/shared'
import { FastifyPluginAsyncTypebox, Type } from '@fastify/type-provider-typebox'
import { StatusCodes } from 'http-status-codes'
import { TableEntity } from '../table/table.entity'
import { FieldEntity } from './field.entity'
import { fieldService } from './field.service'

export const fieldController: FastifyPluginAsyncTypebox = async (fastify) => {

    fastify.post('/', CreateRequest, async (request, reply) => {
        const response = await fieldService.create({ request: request.body, projectId: request.projectId })
        await reply.status(StatusCodes.CREATED).send(response)
    },
    )

    fastify.get('/', GetFieldsRequest, async (request) => {
        return fieldService.getAll({
            projectId: request.projectId,
            tableId: request.query.tableId,
        })
    },
    )

    fastify.get('/:id', GetFieldByIdRequest, (request) => {
        return fieldService.getById({
            id: request.params.id,
            projectId: request.projectId,
        })
    },
    )

    fastify.delete('/:id', DeleteFieldRequest, async (request) => {
        return fieldService.delete({
            id: request.params.id,
            projectId: request.projectId,
        })
    },
    )

    fastify.post('/:id', UpdateRequest, async (request) => {
        return fieldService.update({
            id: request.params.id,
            projectId: request.projectId,
            request: request.body,
        })
    },
    )
}
const CreateRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.ENGINE], undefined, {
            type: ProjectResourceType.TABLE,
            tableName: TableEntity,
            entitySourceType: EntitySourceType.BODY,
            lookup: {
                paramKey: 'tableId',
                entityField: 'id',
            },
        }),
    },
    schema: {
        tags: ['fields'],
        description: 'Create a table field',
        body: CreateFieldRequest,
        response: {
            [StatusCodes.CREATED]: Field,
        },
    },
}

const GetFieldByIdRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.ENGINE], undefined, {
            type: ProjectResourceType.TABLE,
            tableName: FieldEntity,
        }),
    },
    schema: {
        tags: ['fields'],
        description: 'Get a field by id',
        params: Type.Object({
            id: Type.String(),
        }),
    },
}

const DeleteFieldRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.ENGINE], undefined, {
            type: ProjectResourceType.TABLE,
            tableName: FieldEntity,
        }),
    },
    schema: {
        tags: ['fields'],
        description: 'Delete a field',
        params: Type.Object({
            id: Type.String(),
        }),
    },
}

const GetFieldsRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.ENGINE], undefined, {
            type: ProjectResourceType.TABLE,
            tableName: TableEntity,
            entitySourceType: EntitySourceType.QUERY,
            lookup: {
                paramKey: 'tableId',
                entityField: 'id',
            },
        }),
    },
    schema: {
        tags: ['fields'],
        description: 'List all fields for a table',
        querystring: ListFieldsRequestQuery,
    },
}

const UpdateRequest = {
    config: {
        security: securityAccess.project([PrincipalType.USER, PrincipalType.ENGINE], undefined, {
            type: ProjectResourceType.TABLE,
            tableName: FieldEntity,
        }),
    },
    schema: {
        tags: ['fields'],
        description: 'Update a field',
        params: Type.Object({
            id: Type.String(),
        }),
        body: UpdateFieldRequest,
    },
}
