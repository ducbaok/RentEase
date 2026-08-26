'use server'

import type { Route } from 'next'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireOperator } from '@/lib/auth'
import { PLAN_IDS, type PlanId } from '@/lib/domain/plan-limits'
import { loadBillingSnapshot } from '@/lib/stripe/entitlement'
import { isStripeConfigured, StripeNotConfiguredError } from '@/lib/stripe/client'
import { createCheckoutUrl, createPortalUrl } from '@/lib/stripe/checkout'

/**
 * Billing actions — the two buttons that hand a landlord over to Stripe.
 *
 * Neither writes anything. Checkout and the Customer Portal are pages Stripe
 * hosts; what comes back is a URL to send the browser to, and the subscription
 * row is written afterwards by the webhook running as the service role. An
 * `authenticated` session has no write privilege on `subscriptions` at all
 * (migration 0700), so there is no shortcut here to be tempted by.
 *
 * OWNERS ONLY, TWICE OVER.
 * The page refuses to render its controls for a manager, and every action
 * checks again. That is not belt-and-braces for its own sake: a Server Action
 * is an HTTP endpoint with a stable id, callable by anyone who has ever loaded
 * a page that references it, so "the button was not on the screen" is not an
 * access rule. RLS already hides the subscription row from a manager, so the
 * worst case was always a confusing error rather than a leak — this makes it a
 * clear refusal instead.
 *
 * Identity is resolved here from the session and never taken from the form:
 * neither action reads an organization id, and the plan — the only input — is
 * validated against the three we sell before it reaches Stripe.
 */

export interface BillingFormState {
  error?: string
  message?: string
}

const OWNER_ONLY =
  'Only the account owner can manage the subscription. Ask them to make the change on their account.'

const planSchema = z.enum(PLAN_IDS as unknown as [PlanId, ...PlanId[]])

/**
 * `typedRoutes` checks every path against the routes this app declares, which
 * is what stops a link to a renamed page compiling (B1-5). A Stripe-hosted URL
 * is by definition not one of them, so it is asserted here — in one named
 * place, where the assertion is visible — rather than inline at each redirect
 * where it would read as an ordinary route.
 */
function externalRoute(url: string): Route {
  return url as Route
}

/**
 * Starts Stripe Checkout for a plan.
 *
 * The redirect is deliberately outside the try/catch: `redirect()` works by
 * throwing, and a catch that swallowed it would leave the landlord on the
 * billing page with no error and no checkout, which looks exactly like a
 * button that does nothing.
 */
export async function startCheckoutAction(
  _prev: BillingFormState,
  formData: FormData,
): Promise<BillingFormState> {
  const identity = await requireOperator()
  if (identity.role !== 'owner') return { error: OWNER_ONLY }

  const parsed = planSchema.safeParse(formData.get('plan'))
  if (!parsed.success) return { error: 'Choose one of the three plans.' }

  if (!isStripeConfigured()) {
    return {
      error:
        'Checkout is not available on this server — no Stripe key is configured. Everything else keeps working; your trial is unaffected.',
    }
  }

  let url: string
  try {
    const snapshot = await loadBillingSnapshot()
    url = await createCheckoutUrl({
      orgId: identity.orgId,
      orgName: identity.orgName,
      ownerEmail: identity.email,
      plan: parsed.data,
      existingCustomerId: snapshot.subscription?.stripeCustomerId ?? null,
    })
  } catch (error) {
    if (error instanceof StripeNotConfiguredError) return { error: error.message }
    return {
      error: `Stripe could not start the checkout: ${error instanceof Error ? error.message : 'unknown error'}. Nothing has been charged.`,
    }
  }

  redirect(externalRoute(url))
}

/**
 * Opens the Stripe Customer Portal — change card, switch plan, cancel.
 *
 * Needs a customer id, which only exists once a checkout has completed. The
 * page hides the button until then; this is the direct-POST case.
 */
export async function openPortalAction(
  _prev: BillingFormState,
  _formData: FormData,
): Promise<BillingFormState> {
  const identity = await requireOperator()
  if (identity.role !== 'owner') return { error: OWNER_ONLY }

  if (!isStripeConfigured()) {
    return { error: 'The billing portal is not available on this server — no Stripe key is configured.' }
  }

  const snapshot = await loadBillingSnapshot()
  const customerId = snapshot.subscription?.stripeCustomerId
  if (!customerId) {
    return {
      error: 'There is no billing account to open yet. Choose a plan first and the portal appears here.',
    }
  }

  let url: string
  try {
    url = await createPortalUrl(customerId)
  } catch (error) {
    // The most common cause in test mode is a portal configuration that has
    // never been saved in the Stripe dashboard. Saying so beats "an error
    // occurred", because the fix is one click on Stripe's side.
    return {
      error: `Stripe could not open the billing portal: ${error instanceof Error ? error.message : 'unknown error'}. If this is a fresh test-mode account, save a Customer Portal configuration in the Stripe dashboard first.`,
    }
  }

  redirect(externalRoute(url))
}
