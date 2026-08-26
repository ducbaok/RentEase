import { isPlanId, type PlanId } from '@/lib/domain/plan-limits'
import { planForPriceLike } from './plans'

/**
 * Turning a Stripe webhook event into a change to one subscription row.
 *
 * Pure. No network, no database, no SDK instance — which is what lets the whole
 * webhook contract be proved with a table of recorded payloads instead of a
 * Stripe account (D21). The route handler is the shell: verify the signature,
 * call this, write what comes back.
 *
 * IDEMPOTENCY (AC-S1) IS A PROPERTY OF THE SHAPE, NOT OF A DEDUPE TABLE.
 * Every patch this returns is an ABSOLUTE state — "the status is active", "the
 * period ends at this instant" — never a delta. Stripe retries an event until
 * it gets a 2xx and will happily deliver the same one twice; applying the same
 * absolute state twice lands in the same place. There is no event-id table to
 * keep, which matters because the schema is frozen (D7) and adding one would
 * have needed a migration that is not ours to write.
 *
 * WHAT THIS DOES NOT SOLVE, ON PURPOSE
 * Two events delivered out of order — an older `updated` arriving after a
 * `deleted` — would leave the row briefly wrong, because nothing here can tell
 * which event Stripe created first without somewhere to remember it. That is
 * precisely the hole AC-S1 says must not be permanent, and the reconcile sweep
 * (app/api/cron/stripe-reconcile) is what closes it: it asks Stripe what is
 * true now and writes that. A webhook is an optimisation for latency; the
 * reconcile is the correctness guarantee.
 */

export interface SubscriptionPatch {
  plan?: PlanId
  /** Stripe's own status vocabulary. lib/domain/plan-limits.ts reads it. */
  status?: string
  /** ISO timestamp, or null to clear. Undefined means "leave it alone". */
  periodEnd?: string | null
  stripeCustomerId?: string
  stripeSubId?: string
}

/**
 * The same patch as columns on `public.subscriptions`.
 *
 * Declared once and shared by the webhook and the reconcile sweep, so the two
 * write paths cannot drift into naming different columns for the same fact.
 * Keys are omitted rather than set to undefined: an absent key leaves the
 * column alone, which is how an event that says nothing about the plan avoids
 * blanking it.
 */
export interface SubscriptionColumns {
  plan?: PlanId
  status?: string
  period_end?: string | null
  stripe_customer_id?: string | null
  stripe_sub_id?: string | null
}

export function toColumns(patch: SubscriptionPatch): SubscriptionColumns {
  const columns: SubscriptionColumns = {}
  if (patch.plan !== undefined) columns.plan = patch.plan
  if (patch.status !== undefined) columns.status = patch.status
  if (patch.periodEnd !== undefined) columns.period_end = patch.periodEnd
  if (patch.stripeCustomerId !== undefined) columns.stripe_customer_id = patch.stripeCustomerId
  if (patch.stripeSubId !== undefined) columns.stripe_sub_id = patch.stripeSubId
  return columns
}

export interface EventMapping {
  /**
   * The organization, when the event carries it. Null is normal rather than an
   * error: only objects we created carry our metadata, so the handler falls
   * back to looking the customer id up in our own table.
   */
  orgId: string | null
  customerId: string | null
  patch: SubscriptionPatch
}

export type EventOutcome =
  | { handled: false; reason: string }
  | { handled: true; mapping: EventMapping }

/** Event types that change a subscription. Everything else is acknowledged and dropped. */
export const HANDLED_EVENT_TYPES: readonly string[] = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]

interface MinimalEvent {
  type: string
  data?: { object?: unknown }
}

/** Stripe sends unix seconds; the column is a timestamptz. */
function isoFromUnix(seconds: unknown): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null
  return new Date(seconds * 1000).toISOString()
}

/** An id field that Stripe returns either expanded or as a bare string. */
function idOf(value: unknown): string | null {
  if (typeof value === 'string') return value || null
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id
  }
  return null
}

function metadataOf(value: unknown): Record<string, string> {
  const raw = (value as { metadata?: unknown } | null)?.metadata
  if (!raw || typeof raw !== 'object') return {}
  return raw as Record<string, string>
}

export function mapEvent(event: MinimalEvent): EventOutcome {
  const object = event.data?.object
  if (!object || typeof object !== 'object') {
    return { handled: false, reason: `${event.type}: no object on the event` }
  }

  switch (event.type) {
    case 'checkout.session.completed':
      return mapCheckoutSession(object)
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      return mapSubscription(object, false)
    case 'customer.subscription.deleted':
      return mapSubscription(object, true)
    default:
      // Acknowledged, not failed. Stripe sends dozens of event types by
      // default; answering anything but 2xx to the ones we ignore would put
      // them in a retry queue forever and eventually disable the endpoint.
      return { handled: false, reason: `${event.type}: not a subscription event` }
  }
}

/**
 * Checkout finished.
 *
 * This is the event that first ties an organization to a Stripe customer, and
 * it is the only one guaranteed to carry the org id — we put it there when the
 * session was created, both as `client_reference_id` (Stripe's own field for
 * exactly this) and in metadata, because a session created by an older deploy
 * may only have one of them.
 *
 * The status is only claimed when Stripe says the money moved. A completed
 * session whose payment is still processing is not an active subscription, and
 * the `customer.subscription.*` event that follows knows the real answer.
 */
function mapCheckoutSession(session: unknown): EventOutcome {
  const s = session as {
    mode?: string
    client_reference_id?: string | null
    customer?: unknown
    subscription?: unknown
    payment_status?: string
  }

  if (s.mode !== 'subscription') {
    return { handled: false, reason: 'checkout.session.completed: not a subscription checkout' }
  }

  const metadata = metadataOf(session)
  const orgId = s.client_reference_id || metadata.org_id || null
  const patch: SubscriptionPatch = {}

  const customerId = idOf(s.customer)
  if (customerId) patch.stripeCustomerId = customerId

  const subId = idOf(s.subscription)
  if (subId) patch.stripeSubId = subId

  if (isPlanId(metadata.plan)) patch.plan = metadata.plan
  if (s.payment_status === 'paid') patch.status = 'active'

  return { handled: true, mapping: { orgId, customerId, patch } }
}

/**
 * The subscription itself changed — the authoritative event for status.
 *
 * `period_end` comes off the subscription's first item, not off the
 * subscription: recent Stripe API versions moved `current_period_end` to the
 * item, because a subscription can hold items on different cycles. RentEase
 * sells one item per subscription, so the first item is the subscription's
 * period; taking the latest of them keeps that true if that ever stops being
 * the case.
 *
 * A deletion keeps `stripe_customer_id` and `stripe_sub_id` on the row on
 * purpose. The customer is what the Customer Portal is opened with, and a
 * landlord who just cancelled is exactly the person who needs to get back in
 * to restart — clearing it would lock them out of undoing their own decision.
 */
function mapSubscription(subscription: unknown, deleted: boolean): EventOutcome {
  return { handled: true, mapping: subscriptionState(subscription, deleted) }
}

/**
 * The same reading of a Stripe subscription object, exported because the
 * reconcile sweep needs it too.
 *
 * One parser, two callers. A webhook and a reconcile that each interpreted
 * Stripe's payload their own way would disagree eventually — and the whole
 * point of the reconcile is to be the tie-breaker, which it cannot be if it
 * reads the object differently.
 */
export function subscriptionState(subscription: unknown, deleted = false): EventMapping {
  const sub = subscription as {
    id?: string
    customer?: unknown
    status?: string
    ended_at?: number | null
    trial_end?: number | null
    items?: { data?: Array<{ current_period_end?: number; price?: unknown }> }
  }

  const metadata = metadataOf(subscription)
  const customerId = idOf(sub.customer)
  const patch: SubscriptionPatch = {}

  if (typeof sub.id === 'string' && sub.id) patch.stripeSubId = sub.id
  if (customerId) patch.stripeCustomerId = customerId

  // A deleted subscription is 'canceled' whatever the payload says: Stripe
  // sends the object as it was, and its `status` may still read 'active'.
  patch.status = deleted ? 'canceled' : typeof sub.status === 'string' ? sub.status : undefined

  const items = sub.items?.data ?? []
  const periods = items
    .map((item) => (typeof item.current_period_end === 'number' ? item.current_period_end : null))
    .filter((value): value is number => value !== null)

  const periodEnd = deleted
    ? isoFromUnix(sub.ended_at)
    : periods.length > 0
      ? isoFromUnix(Math.max(...periods))
      : isoFromUnix(sub.trial_end)

  // Null only when Stripe told us the period ended; an absent value leaves the
  // column untouched rather than blanking a deadline we already knew.
  if (periodEnd !== null) patch.periodEnd = periodEnd
  else if (deleted) patch.periodEnd = null

  const plan = items.length > 0 ? planFromItem(items[0]) : null
  if (plan) patch.plan = plan
  else if (isPlanId(metadata.plan)) patch.plan = metadata.plan

  return { orgId: metadata.org_id || null, customerId, patch }
}

function planFromItem(item: { price?: unknown } | undefined): PlanId | null {
  const price = item?.price
  if (!price || typeof price !== 'object') return null
  return planForPriceLike(
    price as { lookup_key?: string | null; product?: string | { id?: string } | null; metadata?: Record<string, string> | null },
  )
}
