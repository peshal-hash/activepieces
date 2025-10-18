import {
    OtpType,
    ResetPasswordRequestBody,
    VerifyEmailRequestBody,
} from '@activepieces/ee-shared'
import { ActivepiecesError, ErrorCode, UserId, UserIdentity } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { userIdentityService } from '../../../authentication/user-identity/user-identity-service'
import { otpService } from '../otp/otp-service'

export const enterpriseLocalAuthnService = (log: FastifyBaseLogger) => ({
    async verifyEmail({ identityId }: VerifyEmailRequestBody): Promise<UserIdentity> {
        await confirmOtp({identityId,oldPassword:'',log})

        return userIdentityService(log).verify(identityId)
    },

    async resetPassword({
        identityId,
        oldPassword,
        newPassword,
    }: ResetPasswordRequestBody): Promise<void> {
        await confirmOtp({
            identityId,oldPassword ,log
        })

        await userIdentityService(log).updatePassword({
            id: identityId,
            newPassword,
        })
    },
})

const confirmOtp = async ({
    identityId,
    oldPassword,
    log
}: ConfirmOtpParams): Promise<void> => {
    const isOtpValid = await otpService(log).confirm({identityId,oldPassword})

    if (!isOtpValid) {
        throw new ActivepiecesError({
            code: ErrorCode.INVALID_OTP,
            params: {},
        })
    }
}

type ConfirmOtpParams = {
    identityId: UserId
    oldPassword: string
    log: FastifyBaseLogger
}
