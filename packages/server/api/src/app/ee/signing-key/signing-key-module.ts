import { ApEdition } from '@activepieces/shared'
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { system } from '../../helper/system/system'
import { platformMustHaveFeatureEnabled } from '../authentication/ee-authorization'
import { signingKeyController } from './signing-key-controller'

export const signingKeyModule: FastifyPluginAsyncTypebox = async (app) => {
    if (system.getEdition() !== ApEdition.COMMUNITY) {
        app.addHook('preHandler', platformMustHaveFeatureEnabled((platform) => platform.plan.embeddingEnabled))
    }
    await app.register(signingKeyController, { prefix: '/v1/signing-keys' })
}
