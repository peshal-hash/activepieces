import {
  ApplicationEventName,
  ResetPasswordRequestBody,
  VerifyEmailRequestBody,
} from '@activepieces/ee-shared'
import { securityAccess } from '@activepieces/server-shared'
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Static, Type } from '@sinclair/typebox'
import { applicationEvents } from '../../../helper/application-events'
import { enterpriseLocalAuthnService } from './enterprise-local-authn-service'
import { userIdentityService } from '../../../authentication/user-identity/user-identity-service'

export const enterpriseLocalAuthnController: FastifyPluginAsyncTypebox = async (
  app,
) => {
  app.post('/verify-email', VerifyEmailRequest, async (req) => {
    applicationEvents.sendUserEvent(req, {
      action: ApplicationEventName.USER_EMAIL_VERIFIED,
      data: {},
    })
    await enterpriseLocalAuthnService(req.log).verifyEmail(req.body)
  })

  // Custom: Reset password by EMAIL (converts email to identityId internally)
  app.post('/reset-password', ResetPasswordByEmailRequest, async (req) => {
    const { email, oldPassword, newPassword } = req.body as Static<typeof ResetPasswordByEmailRequestBody>

    // Look up identity by email
    const userIdentity = await userIdentityService(req.log).getIdentityByEmail(email)
    if (!userIdentity) {
      throw new Error('User not found')
    }

    // Send event before resetting
    applicationEvents.sendUserEvent(req, {
      action: ApplicationEventName.USER_PASSWORD_RESET,
      data: {},
    })

    // Convert to identityId-based format and reset
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
    security: securityAccess.public(),
  },
  schema: {
    body: VerifyEmailRequestBody,
  },
}

// Custom: Email-based password reset body (instead of identityId-based)
const ResetPasswordByEmailRequestBody = Type.Object({
  email: Type.String({ format: 'email' }),
  oldPassword: Type.String(),
  newPassword: Type.String({ minLength: 3 }),
})

const ResetPasswordByEmailRequest = {
  config: {
    security: securityAccess.public(),
  },
  schema: {
    body: ResetPasswordByEmailRequestBody,
  },
}
