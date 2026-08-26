/**
 * What a subscription entitles an organization to do — the pure rule behind
 * AC-S2 and AC-S3.
 *
 * This module touches no IO and knows nothing about Stripe. Given a plan, a
 * status, a trial deadline and how many units the organization has, it answers
 * one question: may this organization create another thing right now? The
 * guard that reads the database (lib/stripe/entitlement.ts) is a thin shell
 * around it, which is what lets the whole price ladder be proved with a table
 * of boundary cases instead of a Stripe account.
 *
 * TWO RULES LIVE HERE, AND THEY ARE DIFFERENT.
 *
 *   AC-S2  Over the unit allowance of the paid plan → refuse a NEW unit and
 *          offer the next plan up.
 *   AC-S3  Trial expired without subscribing (or the subscription lapsed) →
 *          refuse every kind of new record.
 *
 * BOTH ONLY EVER REFUSE CREATION. Nothing in this file can be used to hide,
 * freeze or delete anything that already exists: reading data, recording a
 * payment against an invoice already issued, and the resident portal all stay
 * open no matter what it returns. That is the promise in AC-S2 — "never lock
 * the data you already have" — and it is a promise about the *shape* of this
 * module, not merely about how carefully its callers use it.
 *
 * WHY THE TRIAL HAS NO UNIT CEILING
 * The trial exists so a landlord can see the product with their own buildings
 * in it (AC-S3: "full features for 14 days"). A landlord with thirty units who
 * hit a ten-unit wall on day one would be evaluating a different product than
 * the one we are selling. The trial is bounded by time, not by size; the size
 * question is what they answer when they pick a plan at the end of it.
 *
 * Prices and allowances are D5. They are configuration, not architecture —
 * changing them is changing this table (and the Stripe lookup keys in
 * lib/stripe/plans.ts), nothing else.
 */

export type PlanId = 'mini' | 'standard' | 'pro'

/** Cheapest first. Upgrade suggestions walk this order. */
export const PLAN_IDS: readonly PlanId[] = ['mini', 'standard', 'pro']

export interface PlanSpec {
  id: PlanId
  name: string
  /** Monthly price in integer cents (D5, USD). */
  priceCents: number
  /** Units included. `null` means unlimited. */
  unitLimit: number | null
  /**
   * Managers included. `null` means unlimited.
   *
   * DESCRIPTIVE ONLY — nothing enforces this. RentEase has no flow that
   * creates a second operator account (managers exist in seed data alone), so
   * there is no create path to guard; AC-S2 names units and units are what is
   * enforced. When an invite flow arrives, it calls decideCreate() with a
   * 'manager' kind and this number stops being decoration.
   */
  managerLimit: number | null
  /** One line for the plan card. */
  blurb: string
  features: readonly string[]
}

export const PLANS: Readonly<Record<PlanId, PlanSpec>> = {
  mini: {
    id: 'mini',
    name: 'Mini',
    priceCents: 1_900,
    unitLimit: 10,
    managerLimit: 1,
    blurb: 'For a first building or two.',
    features: ['Up to 10 units', '1 manager', 'Meter readings, invoices and payments'],
  },
  standard: {
    id: 'standard',
    name: 'Standard',
    priceCents: 4_900,
    unitLimit: 50,
    managerLimit: 3,
    blurb: 'For a growing portfolio.',
    features: ['Up to 50 units', '3 managers', 'Automatic payment reminders', 'Data export'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceCents: 9_900,
    unitLimit: null,
    managerLimit: null,
    blurb: 'For portfolios that keep growing.',
    features: ['Unlimited units', 'Unlimited managers', 'Multiple properties', 'Priority support'],
  },
}

export function planSpec(plan: PlanId): PlanSpec {
  return PLANS[plan]
}

/** Units included in a plan. `null` is unlimited. */
export function unitLimitFor(plan: PlanId): number | null {
  return PLANS[plan].unitLimit
}

/** Whether a plan id from the database is one we know. */
export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value)
}

/**
 * The cheapest plan that holds this many units.
 *
 * Used for the upgrade prompt: telling someone with 51 units to buy Pro when
 * Standard would have done is the kind of small dishonesty that loses the
 * account. Pro is unlimited, so this never returns null in practice; the type
 * says otherwise only so a future finite top plan cannot silently pretend to
 * fit.
 */
export function smallestPlanFor(unitCount: number): PlanId | null {
  for (const id of PLAN_IDS) {
    const limit = PLANS[id].unitLimit
    if (limit === null || unitCount <= limit) return id
  }
  return null
}

/**
 * Statuses that refuse new records.
 *
 * Stripe's vocabulary, spelled out rather than inverted, because the failure
 * modes are not symmetric. A status we wrongly treat as blocking is a paying
 * customer who cannot add a unit — a support ticket and a refund. A status we
 * wrongly treat as fine costs us one night of extra units until the reconcile
 * sweep corrects it (AC-S1). So anything unrecognised is allowed through, and
 * only these are turned away.
 *
 * `past_due` is deliberately NOT here. Stripe is still retrying the card;
 * locking the landlord out mid-retry punishes them for their bank's timing.
 * The billing page warns instead, and if the retries run out Stripe moves the
 * subscription to `canceled` or `unpaid`, both of which do block.
 */
const BLOCKING_STATUSES: readonly string[] = [
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
]

export interface SubscriptionSnapshot {
  plan: PlanId
  /** Stripe's subscription status, or 'trialing' for the no-card trial (D22). */
  status: string
  /** Trial deadline while trialing; the renewal date once paid. */
  periodEnd: string | Date | null
}

export type EntitlementCode =
  /** Inside the 14-day no-card trial (D22). */
  | 'trialing'
  /** Paying, or in a state we treat as paying. */
  | 'active'
  /** Card retries are failing but nothing is blocked yet. */
  | 'past_due'
  /** The trial ran out and no subscription replaced it (AC-S3). */
  | 'trial_expired'
  /** Canceled, unpaid, or never completed (AC-S3, same posture). */
  | 'inactive'

export interface Entitlement {
  code: EntitlementCode
  /** False only for 'trial_expired' and 'inactive'. Never affects reads. */
  canCreate: boolean
  /** Whole days left in the trial, floor 0. Null when not trialing. */
  trialDaysLeft: number | null
  /** Units allowed right now. `null` is unlimited — including all of the trial. */
  unitLimit: number | null
}

const MS_PER_DAY = 86_400_000

function toTime(value: string | Date | null): number | null {
  if (value === null) return null
  const time = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isNaN(time) ? null : time
}

/**
 * What this subscription allows at this instant.
 *
 * The trial deadline is compared as an instant, not as a calendar date. A trial
 * that started at 14:00 ends at 14:00 fourteen days later — comparing dates
 * would end it at midnight and quietly steal most of a day from every landlord
 * who signed up in the afternoon.
 *
 * `period_end` is only read as a deadline while `trialing`. For a paying
 * subscription it is the renewal date, and a renewal we have not heard about
 * yet (a webhook lost in flight) must not read as an expiry — that would lock
 * a paying customer out for exactly as long as the delivery problem lasts. A
 * paid subscription stops because Stripe says it stopped, which arrives as a
 * status change, and the reconcile sweep is what guarantees we hear about it
 * (AC-S1).
 */
export function entitlementFor(
  subscription: SubscriptionSnapshot,
  asOf: Date = new Date(),
): Entitlement {
  const { plan, status, periodEnd } = subscription

  if (status === 'trialing') {
    const endsAt = toTime(periodEnd)

    // No deadline recorded: an organization created before the trial migration
    // whose backfill has not run. Treated as still trialing — an unreadable
    // deadline is our bookkeeping problem, not the landlord's.
    if (endsAt === null) {
      return { code: 'trialing', canCreate: true, trialDaysLeft: null, unitLimit: null }
    }

    const remainingMs = endsAt - asOf.getTime()
    if (remainingMs <= 0) {
      return {
        code: 'trial_expired',
        canCreate: false,
        trialDaysLeft: 0,
        // The ceiling of the plan they would be on. Reported for the upgrade
        // prompt; nothing is created while canCreate is false anyway.
        unitLimit: unitLimitFor(plan),
      }
    }

    return {
      code: 'trialing',
      canCreate: true,
      trialDaysLeft: Math.ceil(remainingMs / MS_PER_DAY),
      unitLimit: null,
    }
  }

  if (BLOCKING_STATUSES.includes(status)) {
    return { code: 'inactive', canCreate: false, trialDaysLeft: null, unitLimit: unitLimitFor(plan) }
  }

  return {
    code: status === 'past_due' ? 'past_due' : 'active',
    canCreate: true,
    trialDaysLeft: null,
    unitLimit: unitLimitFor(plan),
  }
}

/**
 * The kinds of record the guard is asked about.
 *
 * 'manager' is listed but unreachable today — see PlanSpec.managerLimit.
 */
export type CreateKind = 'unit' | 'property' | 'tenant' | 'lease' | 'invoice' | 'manager'

export type DenialCode = 'trial_expired' | 'inactive' | 'unit_limit'

export interface CreateDecision {
  allowed: boolean
  /** Present only when refused. */
  code: DenialCode | null
  /** Shown to the landlord verbatim. Empty when allowed. */
  message: string
  /** The plan that would lift the refusal, when one would. */
  upgradeTo: PlanId | null
}

const ALLOWED: CreateDecision = { allowed: true, code: null, message: '', upgradeTo: null }

const NOUN: Record<CreateKind, string> = {
  unit: 'units',
  property: 'properties',
  tenant: 'residents',
  lease: 'leases',
  invoice: 'invoices',
  manager: 'managers',
}

export interface CreateRequest {
  subscription: SubscriptionSnapshot
  /** Units the organization already has. */
  unitCount: number
  kind: CreateKind
  asOf?: Date
}

/**
 * May this organization create one more of `kind`?
 *
 * Order matters. An expired trial is answered before the unit ceiling, because
 * "your trial ended" is the true reason and "you have too many units" would
 * send someone to buy a bigger plan for a problem they do not have.
 */
export function decideCreate({
  subscription,
  unitCount,
  kind,
  asOf = new Date(),
}: CreateRequest): CreateDecision {
  const entitlement = entitlementFor(subscription, asOf)

  if (!entitlement.canCreate) {
    // AC-S3 — every kind of new record stops. Everything already recorded is
    // untouched: invoices still open, payments still recordable, portal still
    // serving residents.
    const message =
      entitlement.code === 'trial_expired'
        ? `Your 14-day trial has ended, so no new ${NOUN[kind]} can be added. Everything already in RentEase stays exactly as it is — you can still view it, record payments, and your residents keep their portal. Choose a plan to start adding again.`
        : `This organization does not have an active subscription, so no new ${NOUN[kind]} can be added. Nothing already in RentEase is affected — you can still view it, record payments, and your residents keep their portal. Restart your plan to add again.`

    return {
      allowed: false,
      code: entitlement.code === 'trial_expired' ? 'trial_expired' : 'inactive',
      message,
      // What they should buy is decided by the portfolio they actually have,
      // not by the plan they lapsed from.
      upgradeTo: smallestPlanFor(Math.max(unitCount, 1)),
    }
  }

  // AC-S2 — the unit allowance. Only unit creation is measured against it: a
  // resident, a lease or an invoice costs nothing extra, and refusing those
  // would be punishing the landlord for a limit they did not hit.
  if (kind === 'unit') {
    const limit = entitlement.unitLimit
    if (limit !== null && unitCount >= limit) {
      const next = smallestPlanFor(unitCount + 1)
      const upgradeTo = next === subscription.plan ? null : next
      const suffix = upgradeTo
        ? ` ${PLANS[upgradeTo].name} covers ${PLANS[upgradeTo].unitLimit === null ? 'unlimited units' : `up to ${PLANS[upgradeTo].unitLimit} units`} for $${(PLANS[upgradeTo].priceCents / 100).toFixed(0)}/month.`
        : ''

      return {
        allowed: false,
        code: 'unit_limit',
        message:
          `Your ${PLANS[subscription.plan].name} plan covers ${limit} units and you have ${unitCount}. ` +
          `Nothing is locked — every unit, invoice and resident you already have keeps working exactly as before.${suffix}`,
        upgradeTo,
      }
    }
  }

  return ALLOWED
}
