import Stripe from 'stripe'
import { optionalServerEnv } from '@/lib/env'

/**
 * The Stripe SDK instance.
 *
 * Built lazily and only when a secret key is present, because Stripe is the one
 * part of RentEase that is allowed to be absent. A landlord whose card details
 * we have never asked for is still inside their 14-day trial (D22) and must be
 * able to run their entire month — meter readings, invoices, payments,
 * residents — with no Stripe account configured anywhere. Constructing the
 * client at module load would turn a missing key into a crash on the dashboard
 * rather than a disabled button on one settings page.
 *
 * Everything Stripe-shaped therefore asks isStripeConfigured() first and
 * degrades to an explanation. `pnpm build` and the whole e2e suite run with
 * STRIPE_SECRET_KEY empty, which is what keeps the test suite from depending on
 * Stripe's network (D21: test mode, and never a required one).
 *
 * The API version is deliberately NOT pinned here. The SDK defaults to the
 * version it was generated against, so the types in node_modules and the
 * requests on the wire always agree; pinning a string by hand is how they drift
 * apart on the next upgrade.
 */

export class StripeNotConfiguredError extends Error {
  constructor() {
    super(
      'Stripe is not configured on this server. Set STRIPE_SECRET_KEY (test mode) in .env.local.',
    )
    this.name = 'StripeNotConfiguredError'
  }
}

let cached: Stripe | null = null

export function stripeSecretKey(): string | undefined {
  return optionalServerEnv('STRIPE_SECRET_KEY')
}

export function isStripeConfigured(): boolean {
  return Boolean(stripeSecretKey())
}

export function getStripe(): Stripe {
  const key = stripeSecretKey()
  if (!key) throw new StripeNotConfiguredError()
  if (!cached) {
    cached = new Stripe(key, { appInfo: { name: 'RentEase', url: 'https://rentease.example' } })
  }
  return cached
}

/**
 * Whether this server is talking to Stripe's test mode (D21).
 *
 * Shown on the billing page so nobody mistakes a test-mode subscription for a
 * real one — the two look identical in the UI and only the key says which is
 * which.
 */
export function isTestMode(): boolean {
  return stripeSecretKey()?.startsWith('sk_test_') ?? false
}
