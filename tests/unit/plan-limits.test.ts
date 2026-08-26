import { describe, expect, it } from 'vitest'
import {
  PLANS,
  PLAN_IDS,
  decideCreate,
  entitlementFor,
  isPlanId,
  smallestPlanFor,
  unitLimitFor,
  type CreateKind,
  type PlanId,
  type SubscriptionSnapshot,
} from '@/lib/domain/plan-limits'

/**
 * The price ladder and the two refusals it can produce (AC-S2, AC-S3).
 *
 * Two things are being proved, and the second is the one that matters more:
 *
 *   1. the boundaries are where D5 says they are — 10 and 50 units, off by
 *      nobody, at every edge;
 *   2. a refusal is ALWAYS a refusal to create, and never anything else. The
 *      last describe block walks every blocking state and asserts that reading,
 *      recording payments and the resident portal are untouched — which is the
 *      literal wording of AC-S2 and AC-S3 and the one promise that, broken,
 *      turns a billing bug into a landlord who cannot collect rent.
 */

const NOW = new Date('2026-08-26T12:00:00.000Z')
const DAY = 86_400_000

function at(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString()
}

function sub(over: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return { plan: 'mini', status: 'active', periodEnd: null, ...over }
}

function decide(kind: CreateKind, unitCount: number, over: Partial<SubscriptionSnapshot> = {}) {
  return decideCreate({ subscription: sub(over), unitCount, kind, asOf: NOW })
}

describe('the plan table (D5)', () => {
  it('prices the three plans at $19 / $49 / $99 in integer cents', () => {
    expect(PLANS.mini.priceCents).toBe(1900)
    expect(PLANS.standard.priceCents).toBe(4900)
    expect(PLANS.pro.priceCents).toBe(9900)
  })

  it('allows 10, 50 and unlimited units', () => {
    expect(unitLimitFor('mini')).toBe(10)
    expect(unitLimitFor('standard')).toBe(50)
    expect(unitLimitFor('pro')).toBeNull()
  })

  it('lists the plans cheapest first, which the upgrade suggestion depends on', () => {
    const prices = PLAN_IDS.map((id) => PLANS[id].priceCents)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
  })

  it('recognises exactly the three plan ids', () => {
    for (const id of PLAN_IDS) expect(isPlanId(id)).toBe(true)
    for (const other of ['', 'MINI', 'enterprise', null, undefined, 7]) {
      expect(isPlanId(other)).toBe(false)
    }
  })
})

describe('smallestPlanFor — the cheapest plan that fits', () => {
  it.each<[number, PlanId]>([
    [0, 'mini'],
    [1, 'mini'],
    [9, 'mini'],
    [10, 'mini'],
    [11, 'standard'],
    [49, 'standard'],
    [50, 'standard'],
    [51, 'pro'],
    [500, 'pro'],
    [10_000, 'pro'],
  ])('%i units → %s', (units, plan) => {
    expect(smallestPlanFor(units)).toBe(plan)
  })
})

describe('the 14-day trial (D22, AC-S3)', () => {
  it('is unlimited on units while it runs — the trial is bounded by time, not size', () => {
    const entitlement = entitlementFor(sub({ status: 'trialing', periodEnd: at(7 * DAY) }), NOW)
    expect(entitlement).toEqual({
      code: 'trialing',
      canCreate: true,
      trialDaysLeft: 7,
      unitLimit: null,
    })
    expect(decide('unit', 250, { status: 'trialing', periodEnd: at(7 * DAY) }).allowed).toBe(true)
  })

  it.each([
    [14 * DAY, 14],
    [7 * DAY, 7],
    [DAY, 1],
    // Part of a day left still counts as a day: a landlord told "0 days left"
    // while the trial is still running would think it had already ended.
    [DAY - 1, 1],
    [1, 1],
  ])('reports the days remaining (%i ms → %i days)', (offset, days) => {
    expect(entitlementFor(sub({ status: 'trialing', periodEnd: at(offset) }), NOW).trialDaysLeft)
      .toBe(days)
  })

  it('is still running one millisecond before the deadline', () => {
    const entitlement = entitlementFor(sub({ status: 'trialing', periodEnd: at(1) }), NOW)
    expect(entitlement.code).toBe('trialing')
    expect(entitlement.canCreate).toBe(true)
  })

  it('is over at the deadline itself, and stays over', () => {
    for (const offset of [0, -1, -DAY, -400 * DAY]) {
      const entitlement = entitlementFor(sub({ status: 'trialing', periodEnd: at(offset) }), NOW)
      expect(entitlement.code, `offset ${offset}`).toBe('trial_expired')
      expect(entitlement.canCreate).toBe(false)
      expect(entitlement.trialDaysLeft).toBe(0)
    }
  })

  it('keeps trialing when no deadline was ever recorded', () => {
    // A row from before the trial migration. Our missing bookkeeping must not
    // read as the landlord's expired trial.
    const entitlement = entitlementFor(sub({ status: 'trialing', periodEnd: null }), NOW)
    expect(entitlement.code).toBe('trialing')
    expect(entitlement.canCreate).toBe(true)
    expect(entitlement.trialDaysLeft).toBeNull()
  })

  it('ignores an unparseable deadline rather than locking the account', () => {
    const entitlement = entitlementFor(sub({ status: 'trialing', periodEnd: 'not-a-date' }), NOW)
    expect(entitlement.code).toBe('trialing')
  })

  it('accepts a Date as well as an ISO string', () => {
    const asDate = entitlementFor(
      sub({ status: 'trialing', periodEnd: new Date(NOW.getTime() + 3 * DAY) }),
      NOW,
    )
    expect(asDate.trialDaysLeft).toBe(3)
  })
})

describe('subscription status', () => {
  it.each([
    ['active', 'active', true],
    ['past_due', 'past_due', true],
    ['canceled', 'inactive', false],
    ['unpaid', 'inactive', false],
    ['incomplete', 'inactive', false],
    ['incomplete_expired', 'inactive', false],
    ['paused', 'inactive', false],
  ])('%s → %s (can create: %s)', (status, code, canCreate) => {
    const entitlement = entitlementFor(sub({ status }), NOW)
    expect(entitlement.code).toBe(code)
    expect(entitlement.canCreate).toBe(canCreate)
  })

  it('lets an unrecognised status through rather than locking a paying customer out', () => {
    // A status Stripe adds after this code ships. Wrongly blocking is a refund;
    // wrongly allowing costs one night of extra units until reconcile (AC-S1).
    const entitlement = entitlementFor(sub({ status: 'some_future_status' }), NOW)
    expect(entitlement.code).toBe('active')
    expect(entitlement.canCreate).toBe(true)
  })

  it('does not treat a passed period_end as an expiry once paying', () => {
    // A renewal whose webhook we never received. Reading it as an expiry would
    // lock a paying customer out for as long as the delivery problem lasts.
    const entitlement = entitlementFor(sub({ status: 'active', periodEnd: at(-30 * DAY) }), NOW)
    expect(entitlement.code).toBe('active')
    expect(entitlement.canCreate).toBe(true)
  })

  it('applies the plan ceiling under past_due — a warning, not a lock', () => {
    expect(decide('unit', 9, { status: 'past_due' }).allowed).toBe(true)
    expect(decide('unit', 10, { status: 'past_due' }).code).toBe('unit_limit')
  })
})

describe('the unit allowance (AC-S2)', () => {
  it.each([
    ['mini', 0, true],
    ['mini', 9, true],
    ['mini', 10, false],
    ['mini', 11, false],
    ['standard', 10, true],
    ['standard', 49, true],
    ['standard', 50, false],
    ['standard', 51, false],
    ['pro', 0, true],
    ['pro', 50, true],
    ['pro', 5_000, true],
  ] as Array<[PlanId, number, boolean]>)(
    '%s with %i existing units → creating one more is allowed: %s',
    (plan, unitCount, allowed) => {
      const decision = decide('unit', unitCount, { plan })
      expect(decision.allowed).toBe(allowed)
      if (!allowed) expect(decision.code).toBe('unit_limit')
    },
  )

  it('counts the unit being created, not the ones already there', () => {
    // Ten units on Mini is exactly the allowance: the tenth was fine, the
    // eleventh is not. Off by one here is either a free unit or a customer
    // refused something they paid for.
    expect(decide('unit', 9, { plan: 'mini' }).allowed).toBe(true)
    expect(decide('unit', 10, { plan: 'mini' }).allowed).toBe(false)
  })

  it('suggests the cheapest plan that would fit, not the most expensive', () => {
    const fromMini = decide('unit', 10, { plan: 'mini' })
    expect(fromMini.upgradeTo).toBe('standard')
    expect(fromMini.message).toContain('Standard')
    expect(fromMini.message).toContain('up to 50 units')

    const fromStandard = decide('unit', 50, { plan: 'standard' })
    expect(fromStandard.upgradeTo).toBe('pro')
    expect(fromStandard.message).toContain('unlimited units')
  })

  it('says nothing is locked, in the refusal itself', () => {
    expect(decide('unit', 10, { plan: 'mini' }).message).toMatch(/nothing is locked/i)
  })

  it('measures units only — a resident, lease or invoice is never refused for it', () => {
    for (const kind of ['property', 'tenant', 'lease', 'invoice'] as CreateKind[]) {
      expect(decide(kind, 5_000, { plan: 'mini' }).allowed, kind).toBe(true)
    }
  })
})

describe('an expired trial or a lapsed subscription (AC-S3)', () => {
  const expiredTrial = { status: 'trialing', periodEnd: at(-DAY) }

  it('refuses every kind of new record', () => {
    for (const kind of ['unit', 'property', 'tenant', 'lease', 'invoice'] as CreateKind[]) {
      const decision = decide(kind, 3, expiredTrial)
      expect(decision.allowed, kind).toBe(false)
      expect(decision.code).toBe('trial_expired')
    }
  })

  it('refuses every kind of new record when the subscription was canceled', () => {
    for (const kind of ['unit', 'property', 'tenant', 'lease', 'invoice'] as CreateKind[]) {
      const decision = decide(kind, 3, { status: 'canceled' })
      expect(decision.allowed, kind).toBe(false)
      expect(decision.code).toBe('inactive')
    }
  })

  it('names the trial as the reason, not the unit count', () => {
    // Someone with two units and an expired trial must not be told to buy a
    // bigger plan for a limit they never came close to.
    const decision = decide('unit', 2, expiredTrial)
    expect(decision.code).toBe('trial_expired')
    expect(decision.message).toMatch(/trial has ended/i)
    expect(decision.message).not.toMatch(/covers 10 units/i)
  })

  it('answers the trial before the ceiling even when both would refuse', () => {
    const decision = decide('unit', 40, { plan: 'mini', ...expiredTrial })
    expect(decision.code).toBe('trial_expired')
  })

  it('suggests a plan sized for the portfolio they actually have', () => {
    expect(decide('unit', 3, expiredTrial).upgradeTo).toBe('mini')
    expect(decide('unit', 30, expiredTrial).upgradeTo).toBe('standard')
    expect(decide('unit', 300, expiredTrial).upgradeTo).toBe('pro')
    // An empty portfolio still gets a plan to buy, not null.
    expect(decide('unit', 0, expiredTrial).upgradeTo).toBe('mini')
  })

  it('promises in writing that existing data keeps working', () => {
    for (const state of [expiredTrial, { status: 'canceled' }]) {
      const message = decide('unit', 3, state).message
      expect(message).toMatch(/record payments/i)
      expect(message).toMatch(/portal/i)
    }
  })
})

describe('an allowed decision carries no refusal', () => {
  it('is the same shape every time', () => {
    expect(decide('unit', 0)).toEqual({
      allowed: true,
      code: null,
      message: '',
      upgradeTo: null,
    })
  })
})
