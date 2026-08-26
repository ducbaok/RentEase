import { PLANS, PLAN_IDS, type PlanId } from '@/lib/domain/plan-limits'
import { getStripe } from './client'
import { PRICE_LOOKUP_KEYS, PRODUCT_IDS } from './plans'

/**
 * Making sure this Stripe account has our three products and prices.
 *
 * Separated from plans.ts because this half talks to Stripe and that half must
 * not: the naming in plans.ts is read while handling a webhook, which can
 * happen on a server with no STRIPE_SECRET_KEY, and is read again by the unit
 * tests, which have no environment at all.
 *
 * No price id is ever written down — see plans.ts for why. Everything here is
 * keyed on names we chose, so running it twice changes nothing.
 */

/**
 * The price id to charge for a plan, creating the product and price if this
 * Stripe account has never seen them.
 *
 * Two idempotency mechanisms, one per object: the product is retrieved by the
 * id we chose and only created when that id does not exist; the price is found
 * by lookup key, which Stripe guarantees points at no more than one active
 * price per account.
 */
export async function ensurePlanPrice(plan: PlanId): Promise<string> {
  const stripe = getStripe()
  const lookupKey = PRICE_LOOKUP_KEYS[plan]

  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
  if (existing.data[0]) return existing.data[0].id

  const spec = PLANS[plan]
  const productId = PRODUCT_IDS[plan]

  try {
    await stripe.products.retrieve(productId)
  } catch (error) {
    // Only "there is no such product" may be answered by creating one. Any
    // other failure — a revoked key, Stripe being down — must surface, not be
    // turned into a second product.
    if (!isMissingResource(error)) throw error
    await stripe.products.create({
      id: productId,
      name: `RentEase ${spec.name}`,
      description: spec.blurb,
      metadata: { plan },
    })
  }

  const price = await stripe.prices.create({
    product: productId,
    lookup_key: lookupKey,
    // Takes the key off whatever older price held it, so "the Mini price" keeps
    // meaning one thing after a price change.
    transfer_lookup_key: true,
    currency: 'usd',
    unit_amount: spec.priceCents,
    recurring: { interval: 'month' },
    metadata: { plan },
  })

  return price.id
}

/** Every plan, in one call. For the deploy runbook (D21). */
export async function ensureAllPlanPrices(): Promise<Record<PlanId, string>> {
  const entries = await Promise.all(
    PLAN_IDS.map(async (id) => [id, await ensurePlanPrice(id)] as const),
  )
  return Object.fromEntries(entries) as Record<PlanId, string>
}

function isMissingResource(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { statusCode?: number; code?: string; type?: string }
  return (
    candidate.statusCode === 404 ||
    candidate.code === 'resource_missing' ||
    candidate.type === 'StripeInvalidRequestError'
  )
}
