/**
 * The Stripe webhook endpoint (AC-S1).
 *
 * This is a public URL with no session behind it, so the signature IS the
 * authentication. Everything else in RentEase is protected by knowing who is
 * asking; here we only know that whoever sent this holds the endpoint's signing
 * secret. Get that wrong and anyone on the internet can hand themselves the Pro
 * plan with a curl command.
 *
 * Three details make the verification real rather than ceremonial:
 *
 *   1. THE RAW BODY. The signature covers the exact bytes Stripe sent.
 *      `request.json()` would re-serialise them — different key order, different
 *      number formatting — and every signature would fail, which is the good
 *      outcome; the bad one is somebody "fixing" that by skipping the check.
 *      So the body is read as text and parsed only after it verifies.
 *   2. THE SDK DOES THE COMPARING. Stripe's own implementation handles the
 *      timestamp tolerance that stops a captured request being replayed weeks
 *      later, and compares digests in constant time. Hand-rolling HMAC here
 *      would be re-deriving a security primitive to save one import.
 *   3. NO SECRET, NO ENDPOINT. A missing STRIPE_WEBHOOK_SECRET answers 500 and
 *      writes nothing. Treating "unconfigured" as "skip the check" is how a
 *      staging shortcut becomes a production hole.
 *
 * Note that verification needs only the webhook secret — Stripe.webhooks is a
 * static, so this endpoint works even on a server with no STRIPE_SECRET_KEY.
 * That is what lets the webhook be tested end to end without a Stripe account
 * (D21).
 *
 * Local development:
 *   stripe listen --forward-to localhost:3001/api/webhooks/stripe
 * and put the whsec_... it prints into STRIPE_WEBHOOK_SECRET.
 */

import Stripe from 'stripe'
import { NextResponse } from 'next/server'
import { optionalServerEnv } from '@/lib/env'
import { applyStripeEvent } from './handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const secret = optionalServerEnv('STRIPE_WEBHOOK_SECRET')
  if (!secret) {
    return NextResponse.json(
      { error: 'STRIPE_WEBHOOK_SECRET is not configured on the server.' },
      { status: 500 },
    )
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header.' }, { status: 400 })
  }

  const payload = await request.text()

  let event: Stripe.Event
  try {
    event = Stripe.webhooks.constructEvent(payload, signature, secret)
  } catch (error) {
    // 400, not 500: nothing is wrong with this server. Stripe does not retry a
    // 400, which is right — a body that does not verify will not verify later.
    return NextResponse.json(
      {
        error: 'Signature verification failed.',
        detail: error instanceof Error ? error.message : 'unknown',
      },
      { status: 400 },
    )
  }

  try {
    const result = await applyStripeEvent(event)
    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    // A genuine server-side failure — the database refused the write. This one
    // Stripe SHOULD retry, so it is the one case that answers 500.
    return NextResponse.json(
      {
        error: 'Could not apply the event.',
        detail: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 },
    )
  }
}
