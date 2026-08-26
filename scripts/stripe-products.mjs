#!/usr/bin/env node
/**
 * Creates the three RentEase products and their monthly prices in Stripe (D21).
 *
 * Prices are from D5: Mini $19, Standard $49, Pro $99 per month, USD.
 *
 * IDEMPOTENT, and by a mechanism rather than by hope: every price is created
 * with a `lookup_key`, and the script asks for that key first. Run it twice and
 * the second run finds what the first made. This matters more than it sounds —
 * a duplicated price in Stripe is not tidied up by deleting it, because
 * subscriptions may already reference it.
 *
 *   node scripts/stripe-products.mjs                  # uses STRIPE_SECRET_KEY
 *   node scripts/stripe-products.mjs --dry-run        # print, change nothing
 *
 * It talks to the REST API with fetch rather than importing the Stripe SDK, so
 * it stays independent of lib/stripe/** — that is stream 3A's code, with its own
 * shape and its own tests, and a deploy script that broke when it was
 * refactored would be a deploy script nobody trusts.
 *
 * WHAT TO DO WITH THE OUTPUT
 * It prints each price id against its lookup key. Put them in the environment
 * under whatever names lib/stripe expects — check .env.example on main, since
 * 3A owns those names. The lookup keys are the stable identifiers; the price
 * ids change if a price is ever superseded.
 */

// MIRROR of lib/stripe/plans.ts — that file is the source of truth and the app
// reads it at runtime; this script cannot import it (TypeScript, and it pulls in
// the Stripe client). Every field below must keep matching its counterpart there:
// plan id, product id, lookup key and amount. They are not decorative. The app's
// planForPriceLike() identifies a plan by lookup key first, then by PRODUCT_IDS,
// then by price.metadata.plan — so a product created here under a Stripe-generated
// id, or metadata under a different key, silently disables two of the three.
const PLANS = [
  {
    planId: 'mini',
    productId: 'rentease_mini',
    lookupKey: 'rentease_mini_monthly',
    name: 'RentEase Mini',
    description: 'Up to 10 units, one manager.',
    amountCents: 1900,
  },
  {
    planId: 'standard',
    productId: 'rentease_standard',
    lookupKey: 'rentease_standard_monthly',
    name: 'RentEase Standard',
    description: 'Up to 50 units, three managers, reminders and export.',
    amountCents: 4900,
  },
  {
    planId: 'pro',
    productId: 'rentease_pro',
    lookupKey: 'rentease_pro_monthly',
    name: 'RentEase Pro',
    description: 'Unlimited units and properties, priority support.',
    amountCents: 9900,
  },
]

const CURRENCY = 'usd'
const API = 'https://api.stripe.com/v1'

const dryRun = process.argv.includes('--dry-run')
const key = process.env.STRIPE_SECRET_KEY

if (!key) {
  console.error(
    'STRIPE_SECRET_KEY is not set. Export the key for the account you are configuring:\n' +
      '  sk_test_… while validating, sk_live_… for the real thing.',
  )
  process.exit(1)
}

const mode = key.startsWith('sk_live_') ? 'LIVE' : 'test'
console.log(`Stripe account: ${mode} mode${dryRun ? ' (dry run — nothing will be created)' : ''}\n`)

if (mode === 'LIVE' && !dryRun) {
  console.log('Creating products in a LIVE account. Ctrl-C within five seconds to stop.')
  await new Promise((resolve) => setTimeout(resolve, 5000))
}

/** Stripe's API is form-encoded, including for nested objects. */
function encode(params, prefix = '') {
  const body = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    const field = prefix ? `${prefix}[${name}]` : name
    if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, nested] of Object.entries(value)) {
        body.append(`${field}[${key}]`, String(nested))
      }
    } else {
      body.append(field, String(value))
    }
  }
  return body
}

async function stripe(path, { method = 'GET', params } = {}) {
  const url = method === 'GET' && params ? `${API}${path}?${encode(params)}` : `${API}${path}`
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: method === 'POST' && params ? encode(params) : undefined,
  })

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${payload?.error?.message ?? 'unknown'}`)
  }
  return payload
}

const results = []

for (const plan of PLANS) {
  // The lookup key is the identity. Ask before creating, always.
  const existing = await stripe('/prices', {
    params: { 'lookup_keys[0]': plan.lookupKey, limit: 1, expand: 'data.product' },
  })

  if (existing.data.length > 0) {
    const price = existing.data[0]
    const amount = (price.unit_amount / 100).toFixed(2)
    console.log(`  exists   ${plan.lookupKey}  ${price.id}  $${amount}/${price.recurring?.interval}`)
    if (price.unit_amount !== plan.amountCents) {
      console.log(
        `           NOTE: this price is $${amount}, not $${(plan.amountCents / 100).toFixed(2)}. ` +
          'Stripe prices are immutable — to change it, create a new one under a new lookup key ' +
          'and migrate subscriptions to it.',
      )
    }
    results.push({ plan, priceId: price.id })
    continue
  }

  if (dryRun) {
    console.log(
      `  create   ${plan.lookupKey}  "${plan.name}"  $${(plan.amountCents / 100).toFixed(2)}/month`,
    )
    results.push({ plan, priceId: '(dry run)' })
    continue
  }

  // Our own product id, not a Stripe-generated one, so that the app's second
  // way of recognising a plan keeps working. Ask before creating: running this
  // twice must not end with two products for one plan.
  try {
    await stripe(`/products/${plan.productId}`)
  } catch (error) {
    if (!/→ 404:/.test(String(error.message))) throw error
    await stripe('/products', {
      method: 'POST',
      params: {
        id: plan.productId,
        name: plan.name,
        description: plan.description,
        metadata: { plan: plan.planId },
      },
    })
  }

  const price = await stripe('/prices', {
    method: 'POST',
    params: {
      product: plan.productId,
      currency: CURRENCY,
      unit_amount: plan.amountCents,
      lookup_key: plan.lookupKey,
      recurring: { interval: 'month' },
      metadata: { plan: plan.planId },
    },
  })

  console.log(
    `  created  ${plan.lookupKey}  ${price.id}  $${(plan.amountCents / 100).toFixed(2)}/month`,
  )
  results.push({ plan, priceId: price.id })
}

console.log('\nPrice ids, for the deployment environment:')
for (const { plan, priceId } of results) {
  console.log(`  ${plan.lookupKey.padEnd(28)} ${priceId}`)
}
console.log(
  '\nSet these under the names lib/stripe expects — see .env.example on main, which stream 3A owns.\n' +
    'Prefer looking prices up by lookup_key at runtime where you can: the key survives a price being replaced.',
)
