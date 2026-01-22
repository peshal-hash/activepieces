import { apDayjs, AppSystemProp, WorkerSystemProp } from '@activepieces/server-shared'
import { ApEdition, assertNotNullOrUndefined, isNil, UserWithMetaInformation } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import Stripe from 'stripe'
import { system } from '../../../helper/system/system'
import { ACTIVE_FLOW_PRICE_ID, platformPlanService } from './platform-plan.service'

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
            item => item.price.id === ACTIVE_FLOW_PRICE_ID,
        )

        if (isNil(relevantSubscriptionItem)) {
            return { startDate: defaultStartDate, endDate: defaultEndDate, cancelDate: defaultCancelDate }
        }

        return {
            startDate: relevantSubscriptionItem.current_period_start,
            endDate: relevantSubscriptionItem.current_period_end,
            cancelDate: subscription.cancel_at ?? undefined,
        }
    },
    async handleSubscriptionUpdate(params: HandleSubscriptionUpdateParams): Promise<string> {
        const { extraActiveFlows, isUpgrade, subscriptionId } = params

        try {
            const stripe = stripeHelper(log).getStripe()
            assertNotNullOrUndefined(stripe, 'Stripe is not configured')

            const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
                expand: ['items.data.price'],
            })
            const existingItem = subscription.items.data.find(
                item => item.price.id === ACTIVE_FLOW_PRICE_ID,
            )

            const items: Stripe.SubscriptionUpdateParams.Item[] = []

            if (extraActiveFlows > 0) {
                items.push({
                    id: existingItem?.id,
                    price: ACTIVE_FLOW_PRICE_ID,
                    quantity: extraActiveFlows,
                })
            }
            else if (existingItem) {
                items.push({
                    id: existingItem.id,
                    deleted: true,
                })
            }

            if (items.length === 0) {
                return '/setup/billing/success?action=update'
            }

            await stripe.subscriptions.update(subscriptionId, {
                items,
                proration_behavior: isUpgrade ? 'create_prorations' : 'none',
            })

            return `/setup/billing/success?action=${isUpgrade ? 'upgrade' : 'downgrade'}`
        }
        catch (error) {
            log.error(`Failed to update subscription ${error} `, {
                subscriptionId,
            })
            return '/setup/billing/error'
        }
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

export enum StripeCheckoutType {
    AI_CREDIT_PAYMENT = 'ai-credit-payment',
    AI_CREDIT_AUTO_TOP_UP = 'ai-credit-auto-top-up',
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
    isFreeDowngrade: boolean
}

type CreateAICreditPaymentParams = {
    platformId: string
    customerId: string
    amountInUsd: number
}

type CreateAICreditAutoTopUpCheckoutSessionParams = {
    platformId: string
    customerId: string
}

type CreateAICreditAutoTopUpPaymentIntentParams = {
    platformId: string
    customerId: string
    amountInUsd: number
    paymentMethod: string
}
