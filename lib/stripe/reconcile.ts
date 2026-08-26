import type { PlanId } from '@/lib/domain/plan-limits'
import type { EventMapping, SubscriptionColumns, SubscriptionPatch } from './events'

/**
 * Deciding what a reconcile should write — the pure half of AC-S1.
 *
 * AC-S1 has two clauses and only the first is about webhooks: "the webhook
 * updates the subscription correctly, AND a lost webhook does not leave the
 * state wrong forever." This is the second clause. A webhook is a message that
 * may not arrive; a reconcile is a question we ask Stripe directly, and the
 * answer is authoritative by definition.
 *
 * It is pure so the interesting cases can be written down instead of staged:
 * Stripe says canceled and we still say active, Stripe has a subscription we
 * have never heard of, we hold a subscription id Stripe has forgotten, and the
 * common case where everything already agrees and nothing should be written.
 *
 * TIMESTAMPS ARE COMPARED AS INSTANTS, NOT AS STRINGS. Postgres returns
 * '2026-09-09T12:00:00+00:00' and Stripe gives '2026-09-09T12:00:00.000Z' for
 * the same moment. Compared as text they differ every night, and the sweep
 * would rewrite every row forever while reporting that it had found drift.
 */

export interface LocalSubscription {
  plan: PlanId
  status: string
  periodEnd: string | null
  stripeCustomerId: string | null
  stripeSubId: string | null
}

export type RemoteFinding =
  /** Stripe has a subscription for this organization. */
  | { kind: 'subscription'; state: EventMapping }
  /** Stripe has nothing — never subscribed, or the subscription is gone. */
  | { kind: 'none' }

export interface ReconcileDecision {
  /** Columns to write. Empty means local and Stripe already agree. */
  changes: SubscriptionColumns
  /** One line for the sweep's report. */
  reason: string
}

const IN_SYNC = (reason: string): ReconcileDecision => ({ changes: {}, reason })

function sameInstant(a: string | null, b: string | null | undefined): boolean {
  if (a === null && (b === null || b === undefined)) return true
  if (a === null || b === null || b === undefined) return false
  const left = Date.parse(a)
  const right = Date.parse(b)
  if (Number.isNaN(left) || Number.isNaN(right)) return a === b
  return left === right
}

export function reconcileDecision(
  local: LocalSubscription,
  finding: RemoteFinding,
): ReconcileDecision {
  if (finding.kind === 'none') {
    /*
     * An organization inside its own 14-day trial (D22) has never been to
     * Stripe, so Stripe having nothing is the correct and expected answer. It
     * is not drift and must not be written over — doing so would cancel the
     * trial of every organization that had not paid yet, every night.
     */
    if (!local.stripeSubId) return IN_SYNC('never subscribed — still on the local trial')

    // We hold a subscription id Stripe does not know about. Either it was
    // deleted while we were not listening — the exact lost-webhook case — or
    // the key now points at a different Stripe account. Both mean: not paying.
    if (local.status === 'canceled') return IN_SYNC('already canceled')
    return {
      changes: { status: 'canceled' },
      reason: `Stripe has no subscription ${local.stripeSubId}; local status was '${local.status}'`,
    }
  }

  const patch: SubscriptionPatch = finding.state.patch
  const changes: SubscriptionColumns = {}
  const drifted: string[] = []

  if (patch.plan !== undefined && patch.plan !== local.plan) {
    changes.plan = patch.plan
    drifted.push(`plan ${local.plan} → ${patch.plan}`)
  }
  if (patch.status !== undefined && patch.status !== local.status) {
    changes.status = patch.status
    drifted.push(`status ${local.status} → ${patch.status}`)
  }
  if (patch.periodEnd !== undefined && !sameInstant(local.periodEnd, patch.periodEnd)) {
    changes.period_end = patch.periodEnd
    drifted.push('period_end')
  }
  if (
    patch.stripeCustomerId !== undefined &&
    patch.stripeCustomerId !== local.stripeCustomerId
  ) {
    changes.stripe_customer_id = patch.stripeCustomerId
    drifted.push('stripe_customer_id')
  }
  if (patch.stripeSubId !== undefined && patch.stripeSubId !== local.stripeSubId) {
    changes.stripe_sub_id = patch.stripeSubId
    drifted.push('stripe_sub_id')
  }

  if (drifted.length === 0) return IN_SYNC('already matches Stripe')
  return { changes, reason: drifted.join(', ') }
}
