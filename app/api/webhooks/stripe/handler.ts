import { createAdminClient } from '@/lib/supabase/admin'
import { mapEvent, toColumns } from '@/lib/stripe/events'

/**
 * Applying a verified Stripe event to our own subscription row (AC-S1).
 *
 * Split out of route.ts so the decision — which row, which columns, what
 * happens when the organization cannot be identified — can be read and tested
 * without a signature, a server or a Stripe account.
 *
 * It runs with the service-role client. That is the whole reason webhooks are
 * one of the two directories allowed to import it (lib/supabase/admin.ts):
 * there is no user session behind a Stripe delivery, the event is about an
 * organization nobody is signed in to, and `authenticated` has no write
 * privilege on `subscriptions` by design. Being outside RLS, this file owns its
 * own tenancy: every write is scoped to one resolved org_id, never a blanket
 * update.
 *
 * WHY EVERY OUTCOME IS A 200
 * Stripe retries anything that is not 2xx, with backoff, for days, and
 * eventually disables an endpoint that keeps failing. An event we cannot use is
 * not a failure of delivery, so it is acknowledged and reported in the body.
 * The only thing answered with an error status is a signature that does not
 * verify — that is not Stripe calling.
 */

export type WebhookOutcome =
  | 'applied'
  | 'no-change'
  /** A subscription event for a customer no organization claims. */
  | 'unknown-organization'
  /** An event type that does not concern subscriptions. */
  | 'ignored'

export interface WebhookResult {
  received: true
  outcome: WebhookOutcome
  eventType: string
  orgId: string | null
  /** Columns actually written. Empty for every non-'applied' outcome. */
  changed: string[]
  reason?: string
}

export async function applyStripeEvent(event: {
  type: string
  data?: { object?: unknown }
}): Promise<WebhookResult> {
  const mapped = mapEvent(event)
  if (!mapped.handled) {
    return {
      received: true,
      outcome: 'ignored',
      eventType: event.type,
      orgId: null,
      changed: [],
      reason: mapped.reason,
    }
  }

  const supabase = createAdminClient()
  const { orgId: fromEvent, customerId, patch } = mapped.mapping

  /*
   * Which organization this is about.
   *
   * The metadata we set at checkout is the fast path. The customer id is the
   * fallback that makes the webhook survive things we did not create: a
   * subscription started from the Stripe dashboard, or one migrated from
   * another account, carries no org_id of ours but does carry the customer we
   * already stored.
   */
  let orgId = fromEvent
  if (!orgId && customerId) {
    const { data } = await supabase
      .from('subscriptions')
      .select('org_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()
    orgId = data?.org_id ?? null
  }
  if (!orgId && patch.stripeSubId) {
    const { data } = await supabase
      .from('subscriptions')
      .select('org_id')
      .eq('stripe_sub_id', patch.stripeSubId)
      .maybeSingle()
    orgId = data?.org_id ?? null
  }

  if (!orgId) {
    // Acknowledged, and deliberately loud in the response body: an event we
    // cannot attribute is exactly the kind of drift the reconcile sweep exists
    // to find, and it will — reconcile walks organizations, not events.
    return {
      received: true,
      outcome: 'unknown-organization',
      eventType: event.type,
      orgId: null,
      changed: [],
      reason: customerId
        ? `no organization is linked to Stripe customer ${customerId}`
        : 'the event carried neither an organization nor a customer',
    }
  }

  const columns = toColumns(patch)
  if (Object.keys(columns).length === 0) {
    return {
      received: true,
      outcome: 'no-change',
      eventType: event.type,
      orgId,
      changed: [],
      reason: 'the event carried nothing worth writing',
    }
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .update(columns)
    .eq('org_id', orgId)
    .select('org_id')

  if (error) throw new Error(`updating the subscription failed: ${error.message}`)

  if (!data || data.length === 0) {
    return {
      received: true,
      outcome: 'unknown-organization',
      eventType: event.type,
      orgId,
      changed: [],
      reason: `no subscription row for organization ${orgId}`,
    }
  }

  /*
   * Re-delivery lands here too, and lands in the same place: every value above
   * is absolute, so the second write of the same event sets the columns to what
   * they already hold. 'applied' therefore means "we wrote it", not "something
   * changed" — the two are indistinguishable from outside, which is what makes
   * the endpoint safe to replay.
   */
  return {
    received: true,
    outcome: 'applied',
    eventType: event.type,
    orgId,
    changed: Object.keys(columns).sort(),
  }
}
