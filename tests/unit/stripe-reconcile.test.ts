import { describe, expect, it } from 'vitest'
import { subscriptionState } from '@/lib/stripe/events'
import { PRICE_LOOKUP_KEYS } from '@/lib/stripe/plans'
import {
  reconcileDecision,
  type LocalSubscription,
  type RemoteFinding,
} from '@/lib/stripe/reconcile'

/**
 * The reconcile decision — AC-S1's second clause, "a lost webhook must not
 * leave the state wrong forever".
 *
 * The sweep itself (app/api/cron/stripe-reconcile) is a loop around this
 * function, so the cases that actually matter can be written down rather than
 * staged against a Stripe account: Stripe says cancelled and we still say
 * active; Stripe has a subscription we never heard about; we hold an id Stripe
 * has forgotten; and — the case that runs every night for every organization —
 * everything already agrees and nothing should be written at all.
 *
 * That last one is not a triviality. A sweep that "corrects" rows which are
 * already correct writes to every subscription in the database nightly, floods
 * its own report with false drift, and hides the one row that really is wrong.
 */

const PERIOD_UNIX = 1_788_000_000
const PERIOD_ISO = new Date(PERIOD_UNIX * 1000).toISOString()

function local(over: Partial<LocalSubscription> = {}): LocalSubscription {
  return {
    plan: 'standard',
    status: 'active',
    periodEnd: PERIOD_ISO,
    stripeCustomerId: 'cus_123',
    stripeSubId: 'sub_123',
    ...over,
  }
}

function remote(over: Record<string, unknown> = {}): RemoteFinding {
  return {
    kind: 'subscription',
    state: subscriptionState({
      id: 'sub_123',
      customer: 'cus_123',
      status: 'active',
      metadata: {},
      items: {
        data: [
          {
            current_period_end: PERIOD_UNIX,
            price: { lookup_key: PRICE_LOOKUP_KEYS.standard },
          },
        ],
      },
      ...over,
    }),
  }
}

const NOTHING: RemoteFinding = { kind: 'none' }

describe('when everything already agrees', () => {
  it('writes nothing', () => {
    const decision = reconcileDecision(local(), remote())
    expect(decision.changes).toEqual({})
    expect(decision.reason).toBe('already matches Stripe')
  })

  it('does not mistake a differently-formatted timestamp for drift', () => {
    // Postgres returns '+00:00', Stripe returns 'Z'. Compared as text they
    // differ every single night, and the sweep would rewrite every row in the
    // database forever while reporting drift it had invented.
    const postgresStyle = PERIOD_ISO.replace('.000Z', '+00:00')
    expect(reconcileDecision(local({ periodEnd: postgresStyle }), remote()).changes).toEqual({})
  })

  it('is idempotent — running it again right after a correction finds nothing', () => {
    const before = local({ status: 'past_due' })
    const first = reconcileDecision(before, remote())
    expect(first.changes).toEqual({ status: 'active' })

    const after = local({ ...before, status: 'active' })
    expect(reconcileDecision(after, remote()).changes).toEqual({})
  })
})

describe('when Stripe disagrees with us', () => {
  it('takes Stripe’s status', () => {
    const decision = reconcileDecision(local({ status: 'active' }), remote({ status: 'canceled' }))
    expect(decision.changes).toEqual({ status: 'canceled' })
    expect(decision.reason).toContain('status active → canceled')
  })

  it('takes Stripe’s plan — the landlord upgraded in the portal', () => {
    const decision = reconcileDecision(
      local({ plan: 'mini' }),
      remote({
        items: {
          data: [
            { current_period_end: PERIOD_UNIX, price: { lookup_key: PRICE_LOOKUP_KEYS.pro } },
          ],
        },
      }),
    )
    expect(decision.changes).toEqual({ plan: 'pro' })
  })

  it('takes Stripe’s renewal date', () => {
    const later = PERIOD_UNIX + 30 * 86_400
    const decision = reconcileDecision(
      local(),
      remote({
        items: {
          data: [{ current_period_end: later, price: { lookup_key: PRICE_LOOKUP_KEYS.standard } }],
        },
      }),
    )
    expect(decision.changes).toEqual({ period_end: new Date(later * 1000).toISOString() })
  })

  it('fills in ids we never learned, when the first webhook was the lost one', () => {
    // The worst case AC-S1 describes: checkout completed, every webhook missed,
    // so we hold nothing at all. The sweep finds the subscription by the org_id
    // in its metadata and writes back everything at once.
    const decision = reconcileDecision(
      local({
        plan: 'mini',
        status: 'trialing',
        periodEnd: null,
        stripeCustomerId: null,
        stripeSubId: null,
      }),
      remote(),
    )
    expect(decision.changes).toEqual({
      plan: 'standard',
      status: 'active',
      period_end: PERIOD_ISO,
      stripe_customer_id: 'cus_123',
      stripe_sub_id: 'sub_123',
    })
  })

  it('corrects several fields in one write', () => {
    const decision = reconcileDecision(
      local({ plan: 'mini', status: 'trialing' }),
      remote({ status: 'past_due' }),
    )
    expect(decision.changes).toEqual({ plan: 'standard', status: 'past_due' })
  })
})

describe('when Stripe has nothing for this organization', () => {
  it('leaves an organization on its own trial completely alone', () => {
    // Every organization starts on the 14-day no-card trial (D22) and has never
    // been to Stripe. Treating Stripe's silence as a cancellation here would
    // end the trial of every unpaid organization, every night.
    const decision = reconcileDecision(
      local({ status: 'trialing', stripeCustomerId: null, stripeSubId: null }),
      NOTHING,
    )
    expect(decision.changes).toEqual({})
    expect(decision.reason).toContain('never subscribed')
  })

  it('cancels a subscription id Stripe has forgotten', () => {
    const decision = reconcileDecision(local({ status: 'active' }), NOTHING)
    expect(decision.changes).toEqual({ status: 'canceled' })
    expect(decision.reason).toContain('sub_123')
  })

  it('writes nothing when we already knew it was cancelled', () => {
    expect(reconcileDecision(local({ status: 'canceled' }), NOTHING).changes).toEqual({})
  })
})

describe('what a decision never does', () => {
  it('never touches a column Stripe said nothing about', () => {
    // An UPDATE that named every column would blank the ones the answer did not
    // cover. Only differences are written.
    const decision = reconcileDecision(
      local({ status: 'past_due' }),
      remote({ items: { data: [] } }),
    )
    expect(Object.keys(decision.changes)).toEqual(['status'])
  })

  it('never invents an organization, a unit count or anything but these five columns', () => {
    const decision = reconcileDecision(
      local({ plan: 'mini', status: 'trialing', periodEnd: null }),
      remote(),
    )
    for (const key of Object.keys(decision.changes)) {
      expect([
        'plan',
        'status',
        'period_end',
        'stripe_customer_id',
        'stripe_sub_id',
      ]).toContain(key)
    }
  })
})
