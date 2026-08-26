import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe, isStripeConfigured } from '@/lib/stripe/client'
import { subscriptionState } from '@/lib/stripe/events'
import { isPlanId } from '@/lib/domain/plan-limits'
import {
  reconcileDecision,
  type LocalSubscription,
  type RemoteFinding,
} from '@/lib/stripe/reconcile'

/**
 * The reconcile sweep — orchestration only. The decision of what to write lives
 * in lib/stripe/reconcile.ts and is unit-tested there; this file asks Stripe
 * what is true and applies the answer.
 *
 * WHY A CRON ROUTE RATHER THAN A CHECK ON PAGE LOAD
 * Three reasons, in order of weight:
 *
 *   1. There is nowhere else it could live. Correcting a subscription means
 *      writing `subscriptions`, and only the service role may — which the
 *      eslint rule confines to app/api/cron/** and app/api/webhooks/**. A
 *      "reconcile when the billing page renders" would need a write privilege
 *      the application deliberately does not have.
 *   2. Drift is not something the owner is present for. A subscription can lapse
 *      on a night nobody signs in, and the reminder job, the dashboard and the
 *      unit guard all read the stale row in the meantime. A sweep that runs
 *      whether or not anyone is looking is the only kind that bounds the error.
 *   3. It keeps a Stripe round-trip out of the render path. The billing page
 *      would otherwise wait on stripe.com to draw, and fail to draw when Stripe
 *      is slow.
 *
 * The route it sits behind ALSO accepts a signed-in owner, for their own
 * organization only — because the one moment drift is most visible is the
 * moment somebody comes back from Checkout and the webhook has not landed.
 * Same code, same service role, one org instead of all of them.
 *
 * IDEMPOTENT BY CONSTRUCTION: it writes only differences, so a second run in
 * the same minute writes nothing and reports nothing changed.
 */

export interface ReconcileEntry {
  orgId: string
  changed: string[]
  reason: string
}

export interface ReconcileSummary {
  /** Organizations examined. */
  checked: number
  /** Organizations whose row was corrected. */
  corrected: ReconcileEntry[]
  /** Organizations that already agreed with Stripe. */
  inSync: number
  /** Organizations that could not be checked, with why. */
  failed: Array<{ orgId: string; error: string }>
}

interface SubscriptionRow {
  org_id: string
  plan: string
  status: string
  period_end: string | null
  stripe_customer_id: string | null
  stripe_sub_id: string | null
}

function toLocal(row: SubscriptionRow): LocalSubscription {
  return {
    plan: isPlanId(row.plan) ? row.plan : 'mini',
    status: row.status,
    periodEnd: row.period_end,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubId: row.stripe_sub_id,
  }
}

/** Stripe statuses that mean "this is the subscription that counts". */
const LIVE_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete'])

function mostRelevant(subscriptions: Stripe.Subscription[]): Stripe.Subscription | null {
  if (subscriptions.length === 0) return null
  // A customer can accumulate cancelled subscriptions. The live one is the one
  // being paid for; failing that, the most recently created is the last word.
  const live = subscriptions.filter((sub) => LIVE_STATUSES.has(sub.status))
  const pool = live.length > 0 ? live : subscriptions
  return pool.reduce((newest, sub) => (sub.created > newest.created ? sub : newest))
}

/**
 * What Stripe currently holds for one organization.
 *
 * Three routes in, tried widest last, because each one recovers from a
 * different amount of lost information:
 *
 *   by subscription id  — the normal case; we know exactly what to ask about.
 *   by customer id      — we saw the checkout but never learned the
 *                         subscription; recovers a lost subscription event.
 *   by org_id metadata  — we learned NOTHING, because the very first webhook
 *                         after checkout was the one that went missing. This is
 *                         the worst case AC-S1 describes and the only route
 *                         that reaches it, which is why every subscription is
 *                         created carrying its org_id.
 *
 * Search is eventually consistent (Stripe indexes within a minute or so), which
 * a nightly sweep does not notice and an owner pressing "refresh" a second
 * after checkout might. That is acceptable: the button is the fast path, the
 * sweep is the guarantee.
 */
async function findRemote(stripe: Stripe, orgId: string, local: LocalSubscription): Promise<RemoteFinding> {
  if (local.stripeSubId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(local.stripeSubId)
      return { kind: 'subscription', state: subscriptionState(subscription) }
    } catch (error) {
      if (!isMissingResource(error)) throw error
      // Fall through: Stripe has forgotten this id, so ask the other ways
      // before concluding there is nothing.
    }
  }

  if (local.stripeCustomerId) {
    const list = await stripe.subscriptions.list({
      customer: local.stripeCustomerId,
      status: 'all',
      limit: 10,
    })
    const chosen = mostRelevant(list.data)
    if (chosen) return { kind: 'subscription', state: subscriptionState(chosen) }
  }

  const found = await searchByOrg(stripe, orgId)
  if (found) return { kind: 'subscription', state: subscriptionState(found) }

  return { kind: 'none' }
}

async function searchByOrg(stripe: Stripe, orgId: string): Promise<Stripe.Subscription | null> {
  try {
    const result = await stripe.subscriptions.search({
      query: `metadata['org_id']:'${orgId}'`,
      limit: 10,
    })
    return mostRelevant(result.data)
  } catch {
    // Search is unavailable on some accounts and returns an error rather than
    // an empty page. Not finding anything must not fail the whole sweep.
    return null
  }
}

function isMissingResource(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { statusCode?: number; code?: string }
  return candidate.statusCode === 404 || candidate.code === 'resource_missing'
}

export interface ReconcileOptions {
  /** Limit the sweep to one organization. Used by the owner-triggered path. */
  orgId?: string
}

export class StripeReconcileUnavailableError extends Error {
  constructor() {
    super('Stripe is not configured on this server, so there is nothing to reconcile against.')
    this.name = 'StripeReconcileUnavailableError'
  }
}

export async function runStripeReconcile(
  options: ReconcileOptions = {},
): Promise<ReconcileSummary> {
  if (!isStripeConfigured()) throw new StripeReconcileUnavailableError()

  const stripe = getStripe()
  const supabase = createAdminClient()

  let query = supabase
    .from('subscriptions')
    .select('org_id, plan, status, period_end, stripe_customer_id, stripe_sub_id')
  if (options.orgId) query = query.eq('org_id', options.orgId)

  const { data, error } = await query
  if (error) throw new Error(`loading subscriptions failed: ${error.message}`)

  const rows = (data as SubscriptionRow[] | null) ?? []
  const summary: ReconcileSummary = { checked: 0, corrected: [], inSync: 0, failed: [] }

  for (const row of rows) {
    summary.checked += 1
    const local = toLocal(row)

    try {
      const finding = await findRemote(stripe, row.org_id, local)
      const decision = reconcileDecision(local, finding)

      if (Object.keys(decision.changes).length === 0) {
        summary.inSync += 1
        continue
      }

      const { error: writeError } = await supabase
        .from('subscriptions')
        .update(decision.changes)
        .eq('org_id', row.org_id)

      if (writeError) {
        summary.failed.push({ orgId: row.org_id, error: writeError.message })
        continue
      }

      summary.corrected.push({
        orgId: row.org_id,
        changed: Object.keys(decision.changes).sort(),
        reason: decision.reason,
      })
    } catch (failure) {
      // One organization Stripe cannot answer about must not stop the sweep
      // reaching the rest of them.
      summary.failed.push({
        orgId: row.org_id,
        error: failure instanceof Error ? failure.message : 'unknown',
      })
    }
  }

  return summary
}
