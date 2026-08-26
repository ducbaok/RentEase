import { createClient } from '@/lib/supabase/server'
import { requireOperator } from '@/lib/auth'
import {
  decideCreate,
  entitlementFor,
  isPlanId,
  type CreateDecision,
  type CreateKind,
  type Entitlement,
  type PlanId,
} from '@/lib/domain/plan-limits'

/**
 * Reading the subscription, and the guard the create actions call.
 *
 * The rule itself is in lib/domain/plan-limits.ts and has no idea a database
 * exists. This module is the part that knows who is asking and how many units
 * they have — nothing more.
 *
 * IDENTITY IS RESOLVED HERE, NOT PASSED IN (D19). Neither exported function
 * takes an org id. A guard that accepted one could be called with the wrong
 * one, and a limit you can talk your way past by naming a different
 * organization is not a limit.
 *
 * For the guard, identity is resolved in the strongest form available: the
 * queries carry NO organization filter and let row-level security scope them.
 * The caller's JWT decides which subscription row exists and which units are
 * counted, so there is no org id in this code path at all — not passed in, not
 * looked up, not even named. It is also the cheapest form, which matters:
 * the guard runs on every create, and an extra auth round-trip on the way to
 * saving a resident is latency a landlord pays for on every single record.
 *
 * READS ONLY. Nothing here writes to `subscriptions`, and nothing could:
 * `authenticated` holds nothing but SELECT on that table (migration 0700),
 * asserted directly in supabase/tests/subscription_trial.test.sql. Every write
 * comes from the Stripe webhook or the reconcile sweep, as the service role.
 */

export interface StoredSubscription {
  plan: PlanId
  status: string
  periodEnd: string | null
  stripeCustomerId: string | null
  stripeSubId: string | null
}

export interface BillingSnapshot {
  orgId: string
  orgName: string
  role: 'owner' | 'manager'
  /**
   * Null for two different reasons, and the page must tell them apart: a
   * manager is not permitted to read it (RLS), or an organization somehow has
   * no row. `readable` says which.
   */
  subscription: StoredSubscription | null
  readable: boolean
  unitCount: number
  entitlement: Entitlement
}

/** Every organization has one; used when the row is missing or hidden. */
const ASSUMED_TRIAL: StoredSubscription = {
  plan: 'mini',
  status: 'trialing',
  periodEnd: null,
  stripeCustomerId: null,
  stripeSubId: null,
}

const ALLOWED: CreateDecision = { allowed: true, code: null, message: '', upgradeTo: null }

function toStored(row: {
  plan: string
  status: string
  period_end: string | null
  stripe_customer_id: string | null
  stripe_sub_id: string | null
}): StoredSubscription {
  return {
    // A plan the database holds that this build does not know is treated as the
    // entry plan rather than crashing the billing page. The plan only decides
    // an allowance; guessing low is a conversation, guessing wrong is a 500.
    plan: isPlanId(row.plan) ? row.plan : 'mini',
    status: row.status,
    periodEnd: row.period_end,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubId: row.stripe_sub_id,
  }
}

/**
 * The caller's subscription.
 *
 * With no `orgId` the query is unfiltered and RLS does the scoping: the policy
 * is `org_id = current_org_id() AND current_user_role() = 'owner'`, so an owner
 * sees exactly one row — their own — and everybody else sees none. `orgId` is
 * passed only by the billing page, which has already resolved the identity for
 * its own reasons and may as well say so.
 *
 * `.maybeSingle()` is load-bearing: if more than one row ever came back, RLS
 * would have failed and this returns an error rather than a stranger's plan.
 */
async function readSubscription(orgId?: string): Promise<StoredSubscription | null> {
  const supabase = await createClient()
  let query = supabase
    .from('subscriptions')
    .select('plan, status, period_end, stripe_customer_id, stripe_sub_id')
  if (orgId) query = query.eq('org_id', orgId)

  const { data, error } = await query.maybeSingle()

  // A manager gets no row and no error — RLS hides it rather than refusing it.
  // An actual error (the table gone, the grant revoked) is also answered with
  // null: this is a billing allowance, and taking the whole application down
  // over one unreadable row would break the one promise AC-S2 makes.
  if (error) return null
  return data ? toStored(data) : null
}

/** Units the caller can see, which under RLS is exactly their organization's. */
async function countUnits(orgId?: string): Promise<number> {
  const supabase = await createClient()
  let query = supabase.from('units').select('id', { count: 'exact', head: true })
  if (orgId) query = query.eq('org_id', orgId)

  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

/** Everything the billing page shows, in one round of queries. */
export async function loadBillingSnapshot(): Promise<BillingSnapshot> {
  const identity = await requireOperator()
  const [subscription, unitCount] = await Promise.all([
    readSubscription(identity.orgId),
    countUnits(identity.orgId),
  ])

  return {
    orgId: identity.orgId,
    orgName: identity.orgName,
    role: identity.role,
    subscription,
    readable: subscription !== null,
    unitCount,
    entitlement: entitlementFor(subscription ?? ASSUMED_TRIAL),
  }
}

/**
 * May the caller's organization create one more of `kind`? (AC-S2, AC-S3)
 *
 * Called from the create actions. A refusal is a message to show, never an
 * exception — the caller returns it as a form error next to the button that
 * was pressed, which is what makes "you are over your plan" read as an offer
 * rather than a crash.
 *
 * One query for most kinds, two for a unit. Nothing else is asked of the
 * database, because this runs in front of every create in the application.
 *
 * WHEN THE SUBSCRIPTION CANNOT BE READ, THIS ALLOWS.
 * Today that means one caller: a manager, whom RLS deliberately keeps away
 * from the billing relationship (AC-S2's own posture, migration 0700). The
 * alternative — refusing every create a manager attempts — would stop the
 * people who actually run the buildings from doing their job because of a
 * commercial limit that is not theirs to answer for, and it would do it
 * silently, since they cannot see the subscription to understand why.
 *
 * The gap this leaves is bounded and, today, unreachable: RentEase has no flow
 * that creates a manager at all — the only ones that exist are in seed data —
 * so no production session takes this branch. Closing it properly needs a
 * SECURITY DEFINER function that tells any operator their own organization's
 * allowance without exposing the Stripe relationship, and that is a schema
 * change, frozen for this batch (D7). It is written into the handoff so the
 * manager-invite flow cannot be built without meeting it.
 */
export async function checkCreateAllowance(kind: CreateKind): Promise<CreateDecision> {
  const subscription = await readSubscription()
  if (!subscription) return ALLOWED

  // Only the unit ceiling needs the count, and only for a unit. Everything else
  // is decided by the subscription alone, so nothing else pays for the query.
  const unitCount = kind === 'unit' ? await countUnits() : 0

  return decideCreate({ subscription, unitCount, kind })
}
