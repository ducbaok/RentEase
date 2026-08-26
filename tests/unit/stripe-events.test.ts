import { describe, expect, it } from 'vitest'
import { mapEvent, subscriptionState, toColumns } from '@/lib/stripe/events'
import { PRICE_LOOKUP_KEYS, PRODUCT_IDS, planForPriceLike } from '@/lib/stripe/plans'

/**
 * Reading a Stripe webhook payload (AC-S1, first clause).
 *
 * The payloads below are shaped like the real ones — the fields Stripe actually
 * sends, including the ones that changed recently: `current_period_end` now
 * lives on the subscription ITEM, not on the subscription, and a payload that
 * still looked for it on the subscription would silently record no period at
 * all while appearing to work.
 *
 * The last block is the one that matters most for AC-S1. Stripe retries until
 * it gets a 2xx and will re-send an event we have already applied; every patch
 * here is therefore an absolute state, and mapping the same event twice must
 * produce byte-identical output. There is no dedupe table to lean on — the
 * schema is frozen (D7) — so idempotency has to be a property of the mapping.
 */

const ORG = 'a0000000-0000-4000-8000-000000000001'
const AUG_9 = 1_788_000_000 // a fixed unix second; the exact date is not the point

function checkoutEvent(over: Record<string, unknown> = {}) {
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        mode: 'subscription',
        client_reference_id: ORG,
        customer: 'cus_123',
        subscription: 'sub_123',
        payment_status: 'paid',
        metadata: { org_id: ORG, plan: 'standard' },
        ...over,
      },
    },
  }
}

function subscriptionEvent(type: string, over: Record<string, unknown> = {}) {
  return {
    type,
    data: {
      object: {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'active',
        ended_at: null,
        trial_end: null,
        metadata: { org_id: ORG },
        items: {
          data: [
            {
              current_period_end: AUG_9,
              price: {
                id: 'price_abc',
                lookup_key: PRICE_LOOKUP_KEYS.standard,
                product: PRODUCT_IDS.standard,
                metadata: { plan: 'standard' },
              },
            },
          ],
        },
        ...over,
      },
    },
  }
}

describe('which plan a price belongs to', () => {
  it('reads our lookup key first', () => {
    expect(planForPriceLike({ lookup_key: PRICE_LOOKUP_KEYS.pro })).toBe('pro')
  })

  it('falls back to our product id', () => {
    expect(planForPriceLike({ lookup_key: null, product: PRODUCT_IDS.mini })).toBe('mini')
  })

  it('falls back to metadata, for a price created by hand in the dashboard', () => {
    expect(planForPriceLike({ lookup_key: 'something_else', metadata: { plan: 'standard' } })).toBe(
      'standard',
    )
  })

  it('accepts an expanded product object as well as an id', () => {
    expect(planForPriceLike({ product: { id: PRODUCT_IDS.pro } })).toBe('pro')
  })

  it('returns null for a price that is none of ours', () => {
    expect(planForPriceLike({ lookup_key: 'other', product: 'prod_other' })).toBeNull()
  })
})

describe('checkout.session.completed', () => {
  it('links the organization to its Stripe customer and subscription', () => {
    const outcome = mapEvent(checkoutEvent())
    expect(outcome.handled).toBe(true)
    if (!outcome.handled) return

    expect(outcome.mapping.orgId).toBe(ORG)
    expect(outcome.mapping.patch).toEqual({
      stripeCustomerId: 'cus_123',
      stripeSubId: 'sub_123',
      plan: 'standard',
      status: 'active',
    })
  })

  it('takes the organization from metadata when client_reference_id is absent', () => {
    const outcome = mapEvent(checkoutEvent({ client_reference_id: null }))
    expect(outcome.handled && outcome.mapping.orgId).toBe(ORG)
  })

  it('claims no status while the payment is still processing', () => {
    // A completed session is not a paid subscription. The customer.subscription
    // event that follows knows the real answer; guessing here would show a
    // landlord an active plan they have not paid for.
    const outcome = mapEvent(checkoutEvent({ payment_status: 'unpaid' }))
    expect(outcome.handled && outcome.mapping.patch.status).toBeUndefined()
    expect(outcome.handled && outcome.mapping.patch.stripeCustomerId).toBe('cus_123')
  })

  it('ignores a one-off payment checkout', () => {
    const outcome = mapEvent(checkoutEvent({ mode: 'payment' }))
    expect(outcome.handled).toBe(false)
  })

  it('ignores a plan in metadata that is not one of ours', () => {
    const outcome = mapEvent(checkoutEvent({ metadata: { org_id: ORG, plan: 'enterprise' } }))
    expect(outcome.handled && outcome.mapping.patch.plan).toBeUndefined()
  })
})

describe('customer.subscription.created / updated', () => {
  it('records the status, the period and the plan', () => {
    const outcome = mapEvent(subscriptionEvent('customer.subscription.updated'))
    expect(outcome.handled).toBe(true)
    if (!outcome.handled) return

    expect(outcome.mapping.orgId).toBe(ORG)
    expect(outcome.mapping.patch).toEqual({
      stripeSubId: 'sub_123',
      stripeCustomerId: 'cus_123',
      status: 'active',
      periodEnd: new Date(AUG_9 * 1000).toISOString(),
      plan: 'standard',
    })
  })

  it('reads the period from the subscription ITEM, where Stripe now keeps it', () => {
    // The field moved off the subscription object in a recent API version.
    // Looking in the old place returns undefined and records no deadline at all.
    const outcome = mapEvent(
      subscriptionEvent('customer.subscription.updated', {
        current_period_end: 999,
        items: { data: [{ current_period_end: AUG_9, price: { lookup_key: PRICE_LOOKUP_KEYS.mini } }] },
      }),
    )
    expect(outcome.handled && outcome.mapping.patch.periodEnd).toBe(
      new Date(AUG_9 * 1000).toISOString(),
    )
  })

  it('takes the latest period when a subscription has several items', () => {
    const outcome = mapEvent(
      subscriptionEvent('customer.subscription.updated', {
        items: {
          data: [
            { current_period_end: AUG_9 - 1000, price: { lookup_key: PRICE_LOOKUP_KEYS.mini } },
            { current_period_end: AUG_9, price: { lookup_key: PRICE_LOOKUP_KEYS.mini } },
          ],
        },
      }),
    )
    expect(outcome.handled && outcome.mapping.patch.periodEnd).toBe(
      new Date(AUG_9 * 1000).toISOString(),
    )
  })

  it('falls back to trial_end when no item carries a period', () => {
    const outcome = mapEvent(
      subscriptionEvent('customer.subscription.created', {
        status: 'trialing',
        trial_end: AUG_9,
        items: { data: [] },
      }),
    )
    expect(outcome.handled && outcome.mapping.patch.status).toBe('trialing')
    expect(outcome.handled && outcome.mapping.patch.periodEnd).toBe(
      new Date(AUG_9 * 1000).toISOString(),
    )
  })

  it('leaves the period alone when Stripe sends none', () => {
    const outcome = mapEvent(
      subscriptionEvent('customer.subscription.updated', { items: { data: [] }, trial_end: null }),
    )
    expect(outcome.handled && 'periodEnd' in outcome.mapping.patch).toBe(false)
  })

  it('carries every Stripe status through untranslated', () => {
    for (const status of ['active', 'past_due', 'unpaid', 'incomplete', 'paused']) {
      const outcome = mapEvent(subscriptionEvent('customer.subscription.updated', { status }))
      expect(outcome.handled && outcome.mapping.patch.status, status).toBe(status)
    }
  })

  it('accepts an expanded customer object as well as an id', () => {
    const outcome = mapEvent(
      subscriptionEvent('customer.subscription.updated', { customer: { id: 'cus_expanded' } }),
    )
    expect(outcome.handled && outcome.mapping.patch.stripeCustomerId).toBe('cus_expanded')
  })
})

describe('customer.subscription.deleted', () => {
  it('cancels, whatever status the payload still carries', () => {
    // Stripe sends the object as it was at deletion, and its `status` can still
    // read 'active'. Trusting it would leave a cancelled landlord on a paid plan.
    const outcome = mapEvent(
      subscriptionEvent('customer.subscription.deleted', { status: 'active', ended_at: AUG_9 }),
    )
    expect(outcome.handled && outcome.mapping.patch.status).toBe('canceled')
    expect(outcome.handled && outcome.mapping.patch.periodEnd).toBe(
      new Date(AUG_9 * 1000).toISOString(),
    )
  })

  it('keeps the customer id, so the landlord can get back in to restart', () => {
    const outcome = mapEvent(subscriptionEvent('customer.subscription.deleted', { ended_at: AUG_9 }))
    expect(outcome.handled && outcome.mapping.patch.stripeCustomerId).toBe('cus_123')
    expect(outcome.handled && outcome.mapping.patch.stripeSubId).toBe('sub_123')
  })

  it('clears the period when Stripe did not say when it ended', () => {
    const outcome = mapEvent(
      subscriptionEvent('customer.subscription.deleted', { ended_at: null, items: { data: [] } }),
    )
    expect(outcome.handled && outcome.mapping.patch.periodEnd).toBeNull()
  })
})

describe('events we do not act on', () => {
  it.each([
    'invoice.paid',
    'invoice.payment_failed',
    'customer.created',
    'payment_intent.succeeded',
    'charge.refunded',
  ])('%s is acknowledged, not applied', (type) => {
    const outcome = mapEvent({ type, data: { object: { id: 'x' } } })
    expect(outcome.handled).toBe(false)
    // Acknowledged rather than failed: a non-2xx would put Stripe into a retry
    // loop for days and eventually disable the endpoint.
    if (!outcome.handled) expect(outcome.reason).toContain(type)
  })

  it('survives an event with no object at all', () => {
    const outcome = mapEvent({ type: 'customer.subscription.updated', data: {} })
    expect(outcome.handled).toBe(false)
  })
})

describe('idempotency — a re-delivered event lands in the same place (AC-S1)', () => {
  it.each([
    ['checkout.session.completed', checkoutEvent()],
    ['customer.subscription.updated', subscriptionEvent('customer.subscription.updated')],
    [
      'customer.subscription.deleted',
      subscriptionEvent('customer.subscription.deleted', { ended_at: AUG_9 }),
    ],
  ])('%s maps identically however many times it arrives', (_label, event) => {
    const first = mapEvent(event)
    const second = mapEvent(event)
    const third = mapEvent(event)
    expect(second).toEqual(first)
    expect(third).toEqual(first)
  })

  it('produces absolute values, never deltas', () => {
    // The guarantee behind the above: nothing in a patch is relative to what the
    // row already holds, so applying it twice cannot compound.
    const outcome = mapEvent(subscriptionEvent('customer.subscription.updated'))
    if (!outcome.handled) throw new Error('expected handled')
    for (const value of Object.values(outcome.mapping.patch)) {
      expect(typeof value === 'string' || value === null).toBe(true)
    }
  })
})

describe('turning a patch into columns', () => {
  it('names the columns the database actually has', () => {
    expect(
      toColumns({
        plan: 'pro',
        status: 'active',
        periodEnd: '2026-09-09T00:00:00.000Z',
        stripeCustomerId: 'cus_1',
        stripeSubId: 'sub_1',
      }),
    ).toEqual({
      plan: 'pro',
      status: 'active',
      period_end: '2026-09-09T00:00:00.000Z',
      stripe_customer_id: 'cus_1',
      stripe_sub_id: 'sub_1',
    })
  })

  it('omits what the event said nothing about, rather than blanking it', () => {
    // An UPDATE carrying period_end: undefined would still be sent by
    // PostgREST as a column to write. Omission is the only safe form of
    // "leave it alone".
    expect(toColumns({ status: 'past_due' })).toEqual({ status: 'past_due' })
  })

  it('passes an explicit null through, because null is a real answer', () => {
    expect(toColumns({ periodEnd: null })).toEqual({ period_end: null })
  })
})

describe('subscriptionState is shared with the reconcile sweep', () => {
  it('reads a subscription object the same way the webhook does', () => {
    // One parser, two callers. If these ever diverged, the reconcile could not
    // be the tie-breaker it exists to be.
    const event = subscriptionEvent('customer.subscription.updated')
    const fromEvent = mapEvent(event)
    const direct = subscriptionState(event.data.object)
    expect(fromEvent.handled && fromEvent.mapping).toEqual(direct)
  })
})
