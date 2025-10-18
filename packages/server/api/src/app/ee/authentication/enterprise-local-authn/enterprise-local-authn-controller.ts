import {
  ApplicationEventName,
  VerifyEmailRequestBody,
} from '@activepieces/ee-shared'
import { ALL_PRINCIPAL_TYPES } from '@activepieces/shared'
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type, Static } from '@sinclair/typebox'
import { eventsHooks } from '../../../helper/application-events'
import { enterpriseLocalAuthnService } from './enterprise-local-authn-service'
import { userIdentityService } from '../../../authentication/user-identity/user-identity-service'
import { FastifyBaseLogger } from 'fastify'

export const enterpriseLocalAuthnController: FastifyPluginAsyncTypebox = async (app) => {
  app.post('/verify-email', VerifyEmailRequest, async (req) => {
    eventsHooks.get(req.log).sendUserEventFromRequest(req, {
      action: ApplicationEventName.USER_EMAIL_VERIFIED,
      data: {},
    })
    return enterpriseLocalAuthnService(req.log).verifyEmail(req.body)
  })

  // ✅ Reset password by EMAIL only
  app.post('/reset-password', ResetPasswordByEmailRequest, async (req) => {
    const { email,oldPassword, newPassword } = req.body as Static<typeof ResetPasswordByEmailRequestBody>

    // 1) Look up identity by email
    //    If your service expects a string, change to: getIdentityByEmail(email)
    const userIdentity = await userIdentityService(req.log).getIdentityByEmail(email)
    if (!userIdentity) {
            return

    }

    // 2) Convert to { identityId, newPassword } and reset
    await enterpriseLocalAuthnService(req.log).resetPassword({
      identityId: userIdentity.id,
      oldPassword,
      newPassword,
    })

  })
}

/** Schemas */

const VerifyEmailRequest = {
  config: {
    allowedPrincipals: ALL_PRINCIPAL_TYPES,
  },
  schema: {
    body: VerifyEmailRequestBody,
  },
}

// Only accept { email, newPassword }
const ResetPasswordByEmailRequestBody = Type.Object({
  email: Type.String({ format: 'email' }),
  oldPassword: Type.String(),
  newPassword: Type.String({ minLength: 3 }), // adjust to your password policy
})

const ResetPasswordByEmailRequest = {
  config: {
    allowedPrincipals: ALL_PRINCIPAL_TYPES,
  },
  schema: {
    body: ResetPasswordByEmailRequestBody,
  },
}
