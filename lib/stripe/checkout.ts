import { headers } from 'next/headers'
import { APP_URL } from '@/lib/env'
import type { PlanId } from '@/lib/domain/plan-limits'
import { getStripe } from './client'
import { ensurePlanPrice } from './provisioning'

/**
 * The two hosted pages Stripe runs on our behalf: Checkout (start paying) and
 * the Customer Portal (change card, change plan, cancel).
 *
 * Both are redirects to stripe.com. Nothing here collects a card number, and
 * nothing here writes to our database — the subscription row is written by the
 * webhook that follows, as the service role. That is not a convenience: an
 * `authenticated` session has no write privilege on `subscriptions` at all
 * (migration 0700), so a "quick" local write after checkout would not even be
 * possible, which is the point.
 *
 * NO CUSTOMER IS CREATED HERE EITHER. Checkout is handed the owner's email and
 * Stripe makes the customer as part of the session; the id comes back on
 * `checkout.session.completed` and the webhook stores it. One fewer write path,
 * and no orphaned customers for landlords who open the page and change their
 * mind.
 */

export interface CheckoutRequest {
  orgId: string
  orgName: string
  ownerEmail: string
  plan: PlanId
  /** Set once the organization has been through checkout before. */
  existingCustomerId: string | null
}

/**
 * Where Stripe sends the landlord back to.
 *
 * Taken from the request when there is one, because NEXT_PUBLIC_APP_URL is a
 * deployment-wide constant and each worktree runs its dev server on its own
 * port (3001 here, 3002 for stream 3B). A return_url pointing at the wrong port
 * lands the landlord on another checkout of the application, or on nothing.
 */
async function appOrigin(): Promise<string> {
  try {
    const requestHeaders = await headers()
    const host = requestHeaders.get('host')
    if (host) {
      const protocol = requestHeaders.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
      return `${protocol}://${host}`
    }
  } catch {
    // Called outside a request (a script, a test). Fall through.
  }
  return APP_URL
}

/** Returns the URL to send the landlord to. */
export async function createCheckoutUrl(request: CheckoutRequest): Promise<string> {
  const stripe = getStripe()
  const origin = await appOrigin()
  const priceId = await ensurePlanPrice(request.plan)

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],

    // Both, deliberately. client_reference_id is Stripe's own field for "your
    // id for this customer" and survives into the session event; the metadata
    // copy is what the subscription carries afterwards. The webhook reads
    // whichever it is given.
    client_reference_id: request.orgId,
    metadata: { org_id: request.orgId, plan: request.plan },
    subscription_data: {
      metadata: { org_id: request.orgId, plan: request.plan },
      description: request.orgName,
    },

    ...(request.existingCustomerId
      ? { customer: request.existingCustomerId }
      : { customer_email: request.ownerEmail, customer_creation: 'always' as const }),

    allow_promotion_codes: true,
    success_url: `${origin}/settings/billing?checkout=success`,
    cancel_url: `${origin}/settings/billing?checkout=cancelled`,
  })

  if (!session.url) {
    throw new Error('Stripe created a checkout session without a URL to send you to.')
  }
  return session.url
}

/**
 * The Customer Portal — where a landlord changes card, switches plan or
 * cancels, without us handling any of it.
 *
 * Requires a customer id, which only exists after a first checkout. The billing
 * page therefore offers this button only when there is one; the guard here is
 * for the direct-POST case.
 */
export async function createPortalUrl(customerId: string): Promise<string> {
  const stripe = getStripe()
  const origin = await appOrigin()

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/settings/billing`,
  })

  return session.url
}
