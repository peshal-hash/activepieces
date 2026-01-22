
import { apDayjs, AppSystemProp, WorkerSystemProp } from '@activepieces/server-shared'
import { ApEdition, assertNotNullOrUndefined, isNil, UserWithMetaInformation } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import Stripe from 'stripe'
import { system } from '../../../helper/system/system'
import { ACTIVE_FLOW_PRICE_ID, AI_CREDIT_PRICE_ID, BUSINESS_PLAN_PRICE_ID, PLUS_PLAN_PRICE_ID, PROJECT_PRICE_ID, USER_SEAT_PRICE_ID } from './platform-plan-helper'
import { platformPlanService } from './platform-plan.service'
import { ApSubscriptionStatus, BillingCycle, CreateSubscriptionParams } from '@activepieces/ee-shared'
import { redisConnections } from '../../../database/redis-connections'
import { userService } from '../../../user/user-service'
import { userIdentityService } from '../../../authentication/user-identity/user-identity.service'
import { PlatformRole, PlanName } from '@activepieces/shared'

export const stripeWebhookSecret = system.get(AppSystemProp.STRIPE_WEBHOOK_SECRET)!
const frontendUrl = system.get(WorkerSystemProp.FRONTEND_URL)

export const stripeHelper = (log: FastifyBaseLogger) => ({
    getStripe: (): Stripe | undefined => {
        if (system.getEdition() !== ApEdition.CLOUD) return undefined

        const stripeSecret = system.getOrThrow(AppSystemProp.STRIPE_SECRET_KEY)
        return new Stripe(stripeSecret, {
            apiVersion: '2025-05-28.basil',
        })
    },
    async createCustomer(user: UserWithMetaInformation, platformId: string) {
        const stripe = this.getStripe()
        assertNotNullOrUndefined(stripe, 'Stripe is not configured')

        const newCustomer = await stripe.customers.create({
            email: user.email,
            name: `${user.firstName} ${user.lastName} `,
            description: `Platform ID: ${platformId}, user ${user.id} `,
            metadata: {
                platformId,
                customer_key: `ps_cus_key_${user.email} `,
            },
        })
        return newCustomer.id
    },
    async startTrial(params: StartTrialParams) {
        const { customerId, platformId, plan, existingSubscriptionId } = params

        const stripe = this.getStripe()
        assertNotNullOrUndefined(stripe, 'Stripe is not configured')

        const redisConnection = await redisConnections.useExisting()
        const key = `trial - gift - ${platformId} -${customerId} `
        const redisValue = await redisConnection.get(key)
        const parsedGiftTrial = redisValue
            ? JSON.parse(redisValue)
            : null

        const trialPeriod = parsedGiftTrial?.trialPeriodInUnixTime
            ?? apDayjs().add(14, 'days').unix()

        const trialPlan = parsedGiftTrial?.trialPlan as PlanName
            ?? plan

        const prices = {
            [PlanName.PLUS]: PLUS_PLAN_PRICE_ID,
            [PlanName.BUSINESS]: BUSINESS_PLAN_PRICE_ID,
        }
        const planPrices = prices[trialPlan as PlanName.PLUS | PlanName.BUSINESS]
        if (!planPrices) {
            throw new Error(`Invalid trial plan: ${trialPlan}`)
        }
        const priceId = planPrices[BillingCycle.MONTHLY]

        if (existingSubscriptionId) {
            await stripe.subscriptions.cancel(existingSubscriptionId)
        }

        await stripe.subscriptions.create({
            customer: customerId,
            trial_end: trialPeriod,
            items: [{ price: priceId, quantity: 1 }],
            trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
            metadata: { platformId, trialSubscription: 'true' },
        })
    },
    async giftTrialForCustomer(params: GiftTrialForCustomerParams) {
        const { email, trialPeriod, plan } = params
        const trialPeriodInUnixTime = apDayjs().add(trialPeriod, 'months').unix()
        const stripe = this.getStripe()
        if (isNil(stripe)) {
            return { email, message: 'Stripe not configured' }
        }

        try {
            const identity = await userIdentityService(log).getIdentityByEmail(email)
            if (isNil(identity)) {
                return { email, message: `No user exists with email: ${email} ` }
            }

            const user = await userService.getOneByIdentityIdOnly({ identityId: identity.id })
            if (isNil(user) || isNil(user.platformId) || user.platformRole !== PlatformRole.ADMIN) {
                return { email, message: 'User doesn\'t own any platform' }
            }

            const platformPlan = await platformPlanService(log).getOrCreateForPlatform(user.platformId)
            assertNotNullOrUndefined(platformPlan.stripeCustomerId, 'customerId is not set')

            if (
                isNil(platformPlan.stripeSubscriptionId) ||
                platformPlan.stripeSubscriptionStatus === ApSubscriptionStatus.CANCELED
            ) {
                const redisConnection = await redisConnections.useExisting()
                const key = `trial - gift - ${platformPlan.platformId} -${platformPlan.stripeCustomerId} `
                await platformPlanService(log).update({
                    platformId: platformPlan.platformId,
                    eligibleForTrial: plan,
                })
                const trialData = {
                    trialPeriodInUnixTime,
                    trialPlan: plan,
                }
                await redisConnection.set(key, JSON.stringify(trialData))
                await redisConnection.expire(key, 60 * 60 * 15)
                return
            }
            else if (platformPlan.stripeSubscriptionStatus === ApSubscriptionStatus.TRIALING) {
                await stripe.subscriptions.update(platformPlan.stripeSubscriptionId, {
                    trial_end: trialPeriodInUnixTime,
                })
                return
            }
            else {
                return { email, message: 'User already has active subscription' }
            }
        }
        catch (error) {
            return { email, message: 'Unknown error, contact support for this.' }
        }
    },
    async createSubscriptionCheckoutUrl(
        platformId: string,
        customerId: string,
        params: CreateSubscriptionCheckoutParams,
    ): Promise<string> {
        const stripe = this.getStripe()
        assertNotNullOrUndefined(stripe, 'Stripe is not configured')

        const { plan, cycle, addons } = params

        const basePriceId = plan === PlanName.PLUS ? PLUS_PLAN_PRICE_ID[cycle] : BUSINESS_PLAN_PRICE_ID[cycle]
        const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
            {
                price: basePriceId,
                quantity: 1,
            },
            {
                price: AI_CREDIT_PRICE_ID[cycle],
            },
        ]

        if (!isNil(addons.activeFlows) && addons.activeFlows > 0) {
            lineItems.push({
                price: ACTIVE_FLOW_PRICE_ID[cycle],
                quantity: addons.activeFlows,
            })
        }

        if (!isNil(addons.projects) && addons.projects > 0) {
            lineItems.push({
                price: PROJECT_PRICE_ID[cycle],
                quantity: addons.projects,
            })
        }

        if (!isNil(addons.userSeats) && addons.userSeats > 0) {
            lineItems.push({
                price: USER_SEAT_PRICE_ID[cycle],
                quantity: addons.userSeats,
            })
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'subscription',
            subscription_data: {
                metadata: {
                    platformId,
                },
            },
            success_url: `${frontendUrl} /setup/billing / success ? action = create`,
            cancel_url: `${frontendUrl} /setup/billing / error`,
            customer: customerId,
        })

        return session.url!
    },
    async createPortalSessionUrl(platformId: string): Promise<string> {
        const stripe = this.getStripe()
        assertNotNullOrUndefined(stripe, 'Stripe is not configured')

        const platformBilling = await platformPlanService(log).getOrCreateForPlatform(platformId)
        const session = await stripe.billingPortal.sessions.create({
            customer: platformBilling.stripeCustomerId!,
            return_url: 'https://cloud.activepieces.com/platform/billing',
        })

        return session.url
    },
    async createNewAICreditAutoTopUpCheckoutSession(params: CreateAICreditAutoTopUpCheckoutSessionParams): Promise<string> {
        const stripe = this.getStripe()
        assertNotNullOrUndefined(stripe, 'Stripe is not configured')

        const { customerId, platformId } = params

        const session = await stripe.checkout.sessions.create({
            mode: 'setup',
            payment_method_types: ['card'],
            customer: customerId,
            metadata: {
                platformId,
                type: StripeCheckoutType.AI_CREDIT_AUTO_TOP_UP,
            },

            success_url: `${frontendUrl} /platform/setup / billing / success ? action = ai - credit - auto - topup`,
            cancel_url: `${frontendUrl} /platform/setup / billing / error`,
        })

        return session.url!
    },
    async createNewAICreditAutoTopUpInvoice(
        params: CreateAICreditAutoTopUpPaymentIntentParams,
    ): Promise<void> {
        const stripe = this.getStripe()
        assertNotNullOrUndefined(stripe, 'Stripe is not configured')

        const { customerId, platformId, amountInUsd, paymentMethod } = params
        const amountInCents = amountInUsd * 100

        const invoice = await stripe.invoices.create({
            customer: customerId,
            collection_method: 'charge_automatically',
            auto_advance: true,
            description: 'AI Credits Auto Top-Up',
            metadata: {
                platformId,
                type: StripeCheckoutType.AI_CREDIT_AUTO_TOP_UP,
            },
        })
        assertNotNullOrUndefined(invoice.id, 'Invoice ID is undefined')

        await stripe.invoiceItems.create({
            customer: customerId,
            amount: amountInCents,
            currency: 'usd',
            invoice: invoice.id,
            description: 'AI Credits Auto Top-Up',
            metadata: {
                platformId,
                type: StripeCheckoutType.AI_CREDIT_AUTO_TOP_UP,
            },
        })

        const finalized = await stripe.invoices.finalizeInvoice(invoice.id)
        assertNotNullOrUndefined(finalized.id, 'Finalized invoice ID is undefined')

        await stripe.invoices.pay(finalized.id, {
            off_session: true,
            payment_method: paymentMethod,
        })
    },
    async attachPaymentMethodToCustomer(paymentMethodId: string, customerId: string): Promise<void> {
        const stripe = this.getStripe()
        assertNotNullOrUndefined(stripe, 'Stripe is not configured')

        await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId })
    },
    async getPaymentMethod(customerId: string): Promise<string | null> {
        const stripe = this.getStripe()
        assertNotNullOrUndefined(stripe, 'Stripe is not configured')

        const methods = await stripe.paymentMethods.list({ customer: customerId })
        return methods.data[0]?.id ?? null
    },
    async createNewAICreditPaymentCheckoutSession(params: CreateAICreditPaymentParams): Promise<string> {
        const stripe = this.getStripe()
        assertNotNullOrUndefined(stripe, 'Stripe is not configured')

        const { customerId, platformId, amountInUsd } = params

        const amountInCents = amountInUsd * 100

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'AI Credits Direct Purchase',
                    },
                    unit_amount: amountInCents,
                },
                quantity: 1,
            }],
            mode: 'payment',
            metadata: {
                platformId,
                type: StripeCheckoutType.AI_CREDIT_PAYMENT,
            },
            invoice_creation: {
                enabled: true,
                invoice_data: {
                    metadata: {
                        platformId,
                        type: StripeCheckoutType.AI_CREDIT_PAYMENT,
                    },
                    description: 'AI Credits Purchase',
                },
            },
            allow_promotion_codes: true,
            customer: customerId,
            success_url: `${frontendUrl} /platform/setup / billing / success ? action = ai - credit - payment`,
            cancel_url: `${frontendUrl} /platform/setup / billing / error`,
        })

        return session.url!
    },
    async createNewSubscriptionCheckoutSession(params: StartSubscriptionParams): Promise<string> {
        const stripe = this.getStripe()
        assertNotNullOrUndefined(stripe, 'Stripe is not configured')

        const { customerId, platformId, extraActiveFlows } = params

        const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = []

        if (!isNil(extraActiveFlows) && extraActiveFlows > 0) {
            lineItems.push({
                price: ACTIVE_FLOW_PRICE_ID,
                quantity: extraActiveFlows,
            })
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'subscription',
            subscription_data: {
                metadata: {
                    platformId,
                },
            },
            allow_promotion_codes: true,
            customer: customerId,
            success_url: `${frontendUrl} /platform/setup / billing / success ? action = create`,
            cancel_url: `${frontendUrl} /platform/setup / billing / error`,
        })

        return session.url!
    },

    async getSubscriptionCycleDates(subscription: Stripe.Subscription): Promise<{ startDate: number, endDate: number, cancelDate?: number }> {
        const defaultStartDate = apDayjs().startOf('month').unix()
        const defaultEndDate = apDayjs().endOf('month').unix()
        const defaultCancelDate = undefined

        const relevantSubscriptionItem = subscription.items.data.find(
            item => [ACTIVE_FLOW_PRICE_ID].includes(item.price.id),
        )

        if (isNil(relevantSubscriptionItem)) {
            return { startDate: defaultStartDate, endDate: defaultEndDate, cancelDate: defaultCancelDate }
        }

        return { startDate: relevantSubscriptionItem.current_period_start, endDate: relevantSubscriptionItem.current_period_end, cancelDate: subscription.cancel_at ?? undefined }
    },
    handleSubscriptionUpdate: async (params: HandleSubscriptionUpdateParams): Promise<string> => {
        const { extraActiveFlows, extraProjects, extraUserSeats, isUpgrade, newPlan, subscriptionId, newCycle, currentCycle, isFreeDowngrade } = params

        try {
            const stripe = stripeHelper(log).getStripe()
            assertNotNullOrUndefined(stripe, 'Stripe is not configured')

            const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
                expand: ['items.data.price'],
            })
            const schedules = await stripe.subscriptionSchedules.list({
                customer: subscription.customer as string,
                limit: 10,
            })

            const relevantSchedules = schedules.data.filter(schedule =>
                schedule.subscription === subscription.id ||
                schedule.status === 'active' ||
                schedule.status === 'not_started',
            )

            if (isUpgrade) {
                for (const schedule of relevantSchedules) {
                    await stripe.subscriptionSchedules.release(schedule.id)
                }

                await updateSubscription({ stripe, subscription: subscription, plan: newPlan as PlanName.PLUS | PlanName.BUSINESS, extraUserSeats, extraActiveFlows, extraProjects, newCycle, currentCycle })
            }
            else {
                if (relevantSchedules.length > 0) {
                    const schedule = relevantSchedules[0]
                    await updateSubscriptionSchedule({ stripe, scheduleId: schedule.id, subscription, newPlan, extraUserSeats, logger: log, extraActiveFlows, extraProjects, newCycle, currentCycle, isFreeDowngrade })

                    for (let i = 1; i < relevantSchedules.length; i++) {
                        await stripe.subscriptionSchedules.release(relevantSchedules[i].id)
                    }
                }
                else {
                    await createSubscriptionSchedule({ stripe, subscription, newPlan, extraUserSeats, logger: log, extraActiveFlows, extraProjects, newCycle, currentCycle, isFreeDowngrade })
                }
            }
            return `/ setup / billing / success ? action = ${isUpgrade ? 'upgrade' : 'downgrade'}& plan=${newPlan} `

        }
        catch (error) {
            log.error(`Failed to handle subscription scheduling ${error} `, {
                subscriptionId,
            })
            return '/setup/billing/error'
        }
    },
    deleteCustomer: async (subscriptionId: string): Promise<void> => {
        const stripe = stripeHelper(log).getStripe()
        assertNotNullOrUndefined(stripe, 'Stripe is not configured')
        const invoices = await stripe.invoices.list({ subscription: subscriptionId })
        for (const invoice of invoices.data) {
            if (invoice.id) {
                await stripe.invoices.pay(invoice.id)
            }
        }
        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        if (typeof subscription.customer === 'string') {
            await stripe.customers.del(subscription.customer)
        }
        else {
            await stripe.customers.del(subscription.customer.id)
        }
    },
    async getAutoTopUpInvoicesTotalThisMonth(
        customerId: string,
        platformId: string,
    ): Promise<number> {
        const stripe = this.getStripe()
        assertNotNullOrUndefined(stripe, 'Stripe is not configured')

        const startOfMonth = apDayjs().startOf('month').unix()

        let totalCents = 0

        const invoices = stripe.invoices.list({
            customer: customerId,
            created: {
                gte: startOfMonth,
            },
            status: 'paid',
            collection_method: 'charge_automatically',
            limit: 100,
        })

        for await (const invoice of invoices) {
            if (
                invoice.metadata?.platformId === platformId &&
                invoice.metadata?.type === StripeCheckoutType.AI_CREDIT_AUTO_TOP_UP
            ) {
                totalCents += invoice.amount_paid ?? 0
            }
        }

        return totalCents / 100
    },

})

async function updateSubscription(params: UpdateSubscriptionParams): Promise<void> {
    const { extraActiveFlows, stripe, subscription, currentCycle, newCycle, plan, extraUserSeats, extraProjects } = params
    const items: Stripe.SubscriptionUpdateParams.Item[] = []

    const findItem = (priceIds: string[]) =>
        subscription.items.data.find(item => priceIds.includes(item.price.id))

    const currentPlanItem = findItem([PLUS_PLAN_PRICE_ID[currentCycle], BUSINESS_PLAN_PRICE_ID[currentCycle]])
    const currentAICreditsItem = findItem([AI_CREDIT_PRICE_ID[currentCycle]])
    const currentUserSeatsItem = findItem([USER_SEAT_PRICE_ID[currentCycle]])
    const currentActiveFlowsItem = findItem([ACTIVE_FLOW_PRICE_ID[currentCycle]])
    const currentProjectsItem = findItem([PROJECT_PRICE_ID[currentCycle]])

    if (newCycle !== currentCycle) {
        [currentPlanItem, currentAICreditsItem, currentUserSeatsItem, currentActiveFlowsItem, currentProjectsItem]
            .filter(item => item?.id)
            .forEach(item => items.push({ id: item!.id, deleted: true }))
    }

    items.push({
        id: newCycle === currentCycle ? currentPlanItem?.id : undefined,
        price: plan === PlanName.PLUS ? PLUS_PLAN_PRICE_ID[newCycle] : BUSINESS_PLAN_PRICE_ID[newCycle],
        quantity: 1,
    })

    items.push({
        id: newCycle === currentCycle ? currentAICreditsItem?.id : undefined,
        price: AI_CREDIT_PRICE_ID[newCycle],
    })

    const handleOptionalItem = (
        quantity: number,
        priceId: string,
        currentItem?: Stripe.SubscriptionItem,
    ) => {
        if (quantity > 0) {
            items.push({
                id: newCycle === currentCycle ? currentItem?.id : undefined,
                price: priceId,
                quantity,
            })
        }
        else if (newCycle === currentCycle && currentItem?.id) {
            items.push({
                id: currentItem.id,
                deleted: true,
            })
        }
    }

    handleOptionalItem(extraUserSeats, USER_SEAT_PRICE_ID[newCycle], currentUserSeatsItem)
    handleOptionalItem(extraActiveFlows, ACTIVE_FLOW_PRICE_ID[newCycle], currentActiveFlowsItem)
    handleOptionalItem(extraProjects, PROJECT_PRICE_ID[newCycle], currentProjectsItem)

    await stripe.subscriptions.update(subscription.id, {
        items,
        proration_behavior: 'always_invoice',
    })
}

function buildPhaseItems(cycle: BillingCycle, plan: PlanName, userSeats: number, projects: number, activeFlows: number): Stripe.SubscriptionScheduleUpdateParams.Phase.Item[] {
    const items: Stripe.SubscriptionScheduleUpdateParams.Phase.Item[] = []

    items.push({
        price: plan === PlanName.PLUS ? PLUS_PLAN_PRICE_ID[cycle] : BUSINESS_PLAN_PRICE_ID[cycle],
        quantity: 1,
    })

    items.push({
        price: AI_CREDIT_PRICE_ID[cycle],
    })

    if (userSeats > 0) {
        items.push({
            price: USER_SEAT_PRICE_ID[cycle],
            quantity: userSeats,
        })
    }
    if (projects > 0) {
        items.push({
            price: PROJECT_PRICE_ID[cycle],
            quantity: projects,
        })
    }
    if (activeFlows > 0) {
        items.push({
            price: ACTIVE_FLOW_PRICE_ID[cycle],
            quantity: activeFlows,
        })
    }
    return items
}

async function updateSubscriptionSchedule(params: UpdateSubscriptionScheduleParams): Promise<void> {
    const { extraActiveFlows, extraProjects, extraUserSeats, logger, newPlan, scheduleId, stripe, subscription, currentCycle, newCycle, isFreeDowngrade } = params
    const { startDate: currentPeriodStart, endDate: currentPeriodEnd } = await stripeHelper(logger).getSubscriptionCycleDates(subscription)

    const phases: Stripe.SubscriptionScheduleUpdateParams.Phase[] = []

    let currentPhaseItems: Stripe.SubscriptionScheduleUpdateParams.Phase.Item[]

    if (currentCycle === newCycle) {
        currentPhaseItems = subscription.items.data.map(item => ({
            price: item.price.id,
            quantity: !isNil(item.quantity) ? item.quantity : undefined,
        }))
    }
    else {
        const currentPlan = subscription.items.data.some(item =>
            [PLUS_PLAN_PRICE_ID[currentCycle], BUSINESS_PLAN_PRICE_ID[currentCycle]].includes(item.price.id),
        ) ? (subscription.items.data.some(item => item.price.id === PLUS_PLAN_PRICE_ID[currentCycle]) ? PlanName.PLUS : PlanName.BUSINESS) : PlanName.PLUS

        const currentUserSeats = subscription.items.data.find(item => item.price.id === USER_SEAT_PRICE_ID[currentCycle])?.quantity || 0
        const currentProjects = subscription.items.data.find(item => item.price.id === PROJECT_PRICE_ID[currentCycle])?.quantity || 0
        const currentActiveFlows = subscription.items.data.find(item => item.price.id === ACTIVE_FLOW_PRICE_ID[currentCycle])?.quantity || 0

        currentPhaseItems = buildPhaseItems(currentCycle, currentPlan, currentUserSeats, currentProjects, currentActiveFlows)
    }

    phases.push({
        items: currentPhaseItems,
        start_date: currentPeriodStart,
        end_date: currentPeriodEnd,
    })

    if (!isFreeDowngrade) {
        const nextPhaseItems = buildPhaseItems(newCycle, newPlan, extraUserSeats, extraProjects, extraActiveFlows)

        phases.push({
            items: nextPhaseItems,
            start_date: currentPeriodEnd,
        })
    }

    await stripe.subscriptionSchedules.update(scheduleId, {
        phases,
        end_behavior: isFreeDowngrade ? 'cancel' : 'release',
    })

    logger.info({
        scheduleId,
        subscriptionId: subscription.id,
        effectiveDate: new Date(currentPeriodEnd * 1000).toISOString(),
        willCancel: isFreeDowngrade,
    }, 'Updated subscription schedule for plan change')
}

async function createSubscriptionSchedule(params: CreateSubscriptionScheduleParams): Promise<Stripe.SubscriptionSchedule> {
    const { extraActiveFlows, extraProjects, extraUserSeats, logger, newPlan, stripe, subscription, currentCycle, newCycle, isFreeDowngrade } = params

    const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id,
    })

    await updateSubscriptionSchedule({ stripe, scheduleId: schedule.id, subscription, logger, extraActiveFlows, extraProjects, extraUserSeats, newPlan, currentCycle, newCycle, isFreeDowngrade })
    return schedule
}

type CreateSubscriptionScheduleParams = {
    stripe: Stripe
    subscription: Stripe.Subscription
    extraActiveFlows: number
    extraProjects: number
    extraUserSeats: number
    logger: FastifyBaseLogger
    isFreeDowngrade?: boolean
    newPlan: PlanName
    currentCycle: BillingCycle
    newCycle: BillingCycle
}

type CreateAICreditPaymentParams = {
    platformId: string
    customerId: string
    amountInUsd: number
}

type StartSubscriptionParams = {
    platformId: string
    customerId: string
    extraActiveFlows?: number
}

type HandleSubscriptionUpdateParams = {
    subscriptionId: string
    extraActiveFlows: number
    isUpgrade: boolean
    isFreeDowngrade?: boolean
    newPlan: PlanName
    newCycle: BillingCycle
    currentCycle: BillingCycle
    extraProjects: number
    extraUserSeats: number
}

type UpdateSubscriptionParams = {
    stripe: Stripe
    subscription: Stripe.Subscription
    extraActiveFlows: number
    extraProjects: number
    extraUserSeats: number
    currentCycle: BillingCycle
    newCycle: BillingCycle
    plan: PlanName
}

type UpdateSubscriptionScheduleParams = {
    stripe: Stripe
    scheduleId: string
    subscription: Stripe.Subscription
    extraActiveFlows: number
    extraProjects: number
    extraUserSeats: number
    logger: FastifyBaseLogger
    isFreeDowngrade?: boolean
    newPlan: PlanName
    currentCycle: BillingCycle
    newCycle: BillingCycle
}

type CreateAICreditAutoTopUpCheckoutSessionParams = {
    platformId: string
    customerId: string
}

type StartTrialParams = {
    customerId: string
    platformId: string
    plan: PlanName
    existingSubscriptionId?: string
}

type GiftTrialForCustomerParams = {
    email: string
    trialPeriod: number
    plan: PlanName
}

type CreateAICreditAutoTopUpPaymentIntentParams = {
    platformId: string
    customerId: string
    amountInUsd: number
    paymentMethod: string
}

type CreateSubscriptionCheckoutParams = {
    plan: PlanName
    cycle: BillingCycle
    addons: {
        activeFlows?: number
        projects?: number
        userSeats?: number
    }
}

export enum StripeCheckoutType {
    AI_CREDIT_PAYMENT = 'ai-credit-payment',
    AI_CREDIT_AUTO_TOP_UP = 'ai-credit-auto-top-up',
}
