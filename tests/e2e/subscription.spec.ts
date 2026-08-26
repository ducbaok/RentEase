import { test, expect, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import Stripe from 'stripe'

/**
 * Stream 3A — the subscription, driven end to end (AC-S1, AC-S2, AC-S3).
 *
 * NOTHING HERE TALKS TO STRIPE. Not because it would be slow, but because a
 * suite that needs stripe.com is a suite that goes red on a train. Two
 * substitutions make that possible and neither weakens what is proved:
 *
 *   the webhook is exercised with payloads signed using the same secret and the
 *   same algorithm Stripe uses — Stripe's own SDK generates the header — and
 *   POSTed straight at the route, which is exactly what `stripe listen` does;
 *
 *   subscription states that would take a real card to reach (an expired trial,
 *   a paid plan) are written with the service role, the same identity the
 *   webhook itself writes with.
 *
 * Every organization here is created by the test that needs it, so the file
 * asserts nothing about the shared seed and is safe to run beside stream 3B,
 * repeatedly, in any order. The one exception is the manager check, which uses
 * the seed's manager and only ever READS.
 */

function fromEnvFile(name: string): string | undefined {
  if (process.env[name]) return process.env[name]
  if (!existsSync('.env.local')) return undefined
  const match = readFileSync('.env.local', 'utf8').match(
    new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, 'm'),
  )
  return match?.[1]?.replace(/^["']|["']$/g, '')
}

function required(name: string): string {
  const value = fromEnvFile(name)
  if (!value) throw new Error(`${name} is not set — this suite cannot run without it.`)
  return value
}

const WEBHOOK_SECRET = required('STRIPE_WEBHOOK_SECRET')
const CRON_SECRET = required('CRON_SECRET')

/**
 * The service role, used ONLY to set up states a card would otherwise be needed
 * for, and to read back what the application wrote. It never stands in for the
 * behaviour under test.
 */
function admin(): SupabaseClient {
  return createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const SEED_MANAGER = { email: 'mike@northside.test', password: 'password123' }

interface Landlord {
  email: string
  password: string
  orgName: string
  orgId: string
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'))
}

async function signUpFreshLandlord(page: Page, label: string): Promise<Landlord> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const orgName = `${label} ${stamp}`
  const email = `sub-${label.toLowerCase().replace(/\W+/g, '')}-${stamp}@example.test`
  const password = 'password123'

  await page.goto('/sign-up')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/sign-up\/organization/)
  await page.getByLabel('Business name').fill(orgName)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  const { data, error } = await admin()
    .from('organizations')
    .select('id')
    .eq('name', orgName)
    .single()
  expect(error, `could not find the organization just created: ${error?.message}`).toBeNull()

  return { email, password, orgName, orgId: (data as { id: string }).id }
}

async function createProperty(page: Page, name: string): Promise<string> {
  await page.goto('/properties/new')
  await page.getByLabel('Property name').fill(name)
  await page.getByRole('button', { name: 'Create property' }).click()
  await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/)
  return page.url().split('/').pop() as string
}

async function createUnitViaUi(page: Page, code: string, rent = '1000.00'): Promise<void> {
  await page.goto('/units/new')
  await page.getByLabel('Unit code').fill(code)
  await page.getByLabel('Default rent').fill(rent)
  await page.getByRole('button', { name: 'Create unit' }).click()
}

/** The form's own error region, scoped so Next's route announcer cannot match. */
function formAlert(page: Page) {
  return page.locator('form').getByRole('alert')
}

// ===========================================================================
// Fixtures — three organizations, each owned by exactly one scenario.
// ===========================================================================

/** Untouched by anything else: proves what a brand-new trial looks like. */
let trialOrg: Landlord
/** Put on a paid Mini plan through the webhook, then filled to its ceiling. */
let ceilingOrg: Landlord
/** A full month of real data, then its trial deadline moved into the past. */
let expiredOrg: Landlord
let expiredInvoiceId = ''

test.beforeAll(async ({ browser }) => {
  test.slow()
  const page = await browser.newPage()

  // --- the untouched trial ------------------------------------------------
  trialOrg = await signUpFreshLandlord(page, 'Trial')
  await page.context().clearCookies()

  // --- the organization that will hit its unit ceiling --------------------
  ceilingOrg = await signUpFreshLandlord(page, 'Ceiling')
  const ceilingProperty = await createProperty(page, 'Ceiling Court')

  // Ten units, inserted directly. Creating them through the form would prove
  // nothing the eleventh does not, and would take ten page loads to do it.
  const { error: seedError } = await admin()
    .from('units')
    .insert(
      Array.from({ length: 10 }, (_, index) => ({
        org_id: ceilingOrg.orgId,
        property_id: ceilingProperty,
        code: `${101 + index}`,
        base_rent_cents: 100_000,
      })),
    )
  expect(seedError, `seeding units failed: ${seedError?.message}`).toBeNull()
  await page.context().clearCookies()

  // --- the organization whose trial will expire ---------------------------
  expiredOrg = await signUpFreshLandlord(page, 'Expiring')
  await createProperty(page, 'Expiring Court')
  await createUnitViaUi(page, '101')
  await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}$/)

  await page.goto('/tariffs')
  await page.getByLabel('Rates start on').fill('2026-01-01')
  await page.getByLabel('Service fee per month ($)').fill('25.00')
  await page.getByLabel('Electricity ($ per kWh)').fill('0.14')
  await page.getByLabel('Water ($ per gal)').fill('0.012')
  await page.getByRole('button', { name: 'Save rates' }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Jan 1, 2026' })).toBeVisible()

  await page.goto('/tenants/new')
  await page.getByLabel('Full name').fill('Ada Stillowes')
  await page.getByLabel('Email').fill(`ada-${Date.now()}@example.test`)
  await page.getByRole('button', { name: 'Create resident' }).click()
  await expect(page).toHaveURL(/\/tenants\/[0-9a-f-]{36}$/)

  await page.goto('/leases/new')
  await page.getByLabel('Unit').selectOption({ index: 0 })
  await page.getByLabel('Resident').selectOption({ index: 0 })
  await page.getByLabel('Start date').fill('2026-01-01')
  await page.getByLabel('Billing day').fill('9')
  await page.getByLabel('Deposit').fill('1000')
  await page.getByRole('button', { name: 'Create lease' }).click()
  await expect(page).toHaveURL(/\/leases\/[0-9a-f-]{36}$/)

  // One issued invoice, so "you can still record a payment" has something to
  // be recorded against once the trial is gone.
  await page.goto('/invoices/issue?period=2026-03')
  await page.getByRole('button', { name: /^Issue \d+ invoice/ }).click()
  await expect(page.getByText(/Issued 1 invoice for 2026-03/)).toBeVisible()

  const { data: invoice } = await admin()
    .from('invoices')
    .select('id')
    .eq('org_id', expiredOrg.orgId)
    .eq('period', '2026-03')
    .single()
  expiredInvoiceId = (invoice as { id: string }).id

  await page.close()
})

// ===========================================================================
// AC-S3 · the trial itself
// ===========================================================================

test.describe('a new organization gets an open-ended trial with no card (D22 as amended by D24, AC-S3)', () => {
  test('the billing page says so, without a meaningless countdown', async ({ page }) => {
    await signIn(page, trialOrg.email, trialOrg.password)
    await page.goto('/settings/billing')

    await expect(page.getByText('Free trial', { exact: true })).toBeVisible()
    // D24 — billing is deferred, so the trial has no end date. A literal
    // countdown here would read "26801 days left", which is why the page has a
    // threshold rather than a number.
    await expect(page.getByText(/no end date while we are not charging/)).toBeVisible()
    await expect(page.getByText(/No card needed/)).toBeVisible()
  })

  test('the deadline was recorded at signup, not left for the app to invent', async () => {
    const { data } = await admin()
      .from('subscriptions')
      .select('status, period_end')
      .eq('org_id', trialOrg.orgId)
      .single()

    const row = data as { status: string; period_end: string | null }
    expect(row.status).toBe('trialing')
    expect(row.period_end).not.toBeNull()

    // D24: far enough out that no organization can lock itself out while there
    // is no way to pay. Asserted as "beyond any plausible countdown" rather than
    // against the exact sentinel, so this test does not become the second place
    // that date is written down (B3-6).
    const daysOut = (Date.parse(row.period_end as string) - Date.now()) / 86_400_000
    expect(daysOut).toBeGreaterThan(365)
  })

  test('the trial has no unit ceiling — it is bounded by time, not size', async ({ page }) => {
    // AC-S3 promises the full product for 14 days. A landlord with thirty units
    // meeting a ten-unit wall on day one is evaluating a different product.
    await signIn(page, trialOrg.email, trialOrg.password)
    await createProperty(page, 'Trial Court')
    await createUnitViaUi(page, '101')
    await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}$/)

    await page.goto('/settings/billing')
    await expect(page.getByText(/no limit/)).toBeVisible()
  })
})

// ===========================================================================
// AC-S2 · the unit ceiling
// ===========================================================================

test.describe('over the unit allowance (AC-S2)', () => {
  test('the webhook is what puts the organization on a paid plan', async ({ request }) => {
    const applied = await deliver(
      request,
      subscriptionEvent({
        orgId: ceilingOrg.orgId,
        status: 'active',
        plan: 'mini',
        subId: `sub_ceiling_${Date.now()}`,
        customerId: `cus_ceiling_${Date.now()}`,
      }),
    )
    expect(applied.outcome).toBe('applied')

    const { data } = await admin()
      .from('subscriptions')
      .select('plan, status')
      .eq('org_id', ceilingOrg.orgId)
      .single()
    expect(data).toMatchObject({ plan: 'mini', status: 'active' })
  })

  test('the eleventh unit is refused, with the next plan up named and priced', async ({ page }) => {
    await signIn(page, ceilingOrg.email, ceilingOrg.password)
    await createUnitViaUi(page, '111')

    // Still on the form — no redirect to a unit that was not created.
    await expect(page).toHaveURL(/\/units\/new/)
    const error = formAlert(page)
    await expect(error).toContainText('Mini plan covers 10 units and you have 10')
    await expect(error).toContainText('Standard covers up to 50 units for $49/month')
  })

  test('nothing already there is locked — the promise AC-S2 actually makes', async ({ page }) => {
    await signIn(page, ceilingOrg.email, ceilingOrg.password)

    // Every unit still lists and still opens.
    await page.goto('/units')
    await expect(page.getByRole('row').filter({ hasText: '101' }).first()).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: '110' }).first()).toBeVisible()

    // And still saves. Editing is not creating.
    const unitId = await unitIdFor(ceilingOrg.orgId, '110')
    await page.goto(`/units/${unitId}/edit`)
    await page.getByLabel('Default rent').fill('1234.00')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page).toHaveURL(`/units/${unitId}`)
    await expect(page.getByText('$1,234.00').first()).toBeVisible()
  })

  test('the billing page offers the upgrade instead of hiding the problem', async ({ page }) => {
    await signIn(page, ceilingOrg.email, ceilingOrg.password)
    await page.goto('/settings/billing')

    await expect(page.getByText('You have reached the units your plan covers')).toBeVisible()
    await expect(page.getByText('10 of 10 units used')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Choose Standard' })).toBeVisible()
  })
})

// ===========================================================================
// AC-S3 · after the trial runs out
// ===========================================================================

test.describe('when the trial has ended (AC-S3)', () => {
  test.beforeAll(async () => {
    // The one thing a test cannot wait fourteen days for.
    const { error } = await admin()
      .from('subscriptions')
      .update({ period_end: new Date(Date.now() - 86_400_000).toISOString() })
      .eq('org_id', expiredOrg.orgId)
    expect(error, `expiring the trial failed: ${error?.message}`).toBeNull()
  })

  test('creating anything new is refused, and says why', async ({ page }) => {
    await signIn(page, expiredOrg.email, expiredOrg.password)

    await page.goto('/properties/new')
    await page.getByLabel('Property name').fill('One Too Many')
    await page.getByRole('button', { name: 'Create property' }).click()
    await expect(page).toHaveURL(/\/properties\/new/)
    await expect(formAlert(page)).toContainText('14-day trial has ended')

    await createUnitViaUi(page, '999')
    await expect(page).toHaveURL(/\/units\/new/)
    await expect(formAlert(page)).toContainText('14-day trial has ended')

    await page.goto('/tenants/new')
    await page.getByLabel('Full name').fill('Nobody New')
    await page.getByRole('button', { name: 'Create resident' }).click()
    await expect(page).toHaveURL(/\/tenants\/new/)
    await expect(formAlert(page)).toContainText('14-day trial has ended')
  })

  test('issuing next month’s invoices is refused too', async ({ page }) => {
    await signIn(page, expiredOrg.email, expiredOrg.password)
    await page.goto('/invoices/issue?period=2026-04')
    await page.getByRole('button', { name: /^Issue \d+ invoice/ }).click()
    await expect(page.getByText(/14-day trial has ended/)).toBeVisible()

    const { count } = await admin()
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', expiredOrg.orgId)
      .eq('period', '2026-04')
    expect(count).toBe(0)
  })

  test('the rent already owed can still be collected — nothing is locked', async ({ page }) => {
    // This is the sentence AC-S3 turns on. A landlord who cannot record the cash
    // in their hand has been locked out of their own business over a $19 plan.
    await signIn(page, expiredOrg.email, expiredOrg.password)

    await page.goto(`/invoices/${expiredInvoiceId}`)
    await expect(page.getByText('Ada Stillowes').first()).toBeVisible()

    await page.getByLabel('Amount received ($)').fill('500.00')
    await page.getByRole('button', { name: 'Record payment' }).click()
    await expect(page.getByText(/Payment recorded/)).toBeVisible()

    const { data } = await admin()
      .from('invoices')
      .select('paid_cents, status')
      .eq('id', expiredInvoiceId)
      .single()
    expect((data as { paid_cents: number }).paid_cents).toBe(50_000)
  })

  test('existing records still open and still save', async ({ page }) => {
    await signIn(page, expiredOrg.email, expiredOrg.password)

    await page.goto('/units')
    await expect(page.getByRole('row').filter({ hasText: '101' }).first()).toBeVisible()

    const unitId = await unitIdFor(expiredOrg.orgId, '101')
    await page.goto(`/units/${unitId}/edit`)
    await page.getByLabel('Default rent').fill('1500.00')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page).toHaveURL(`/units/${unitId}`)
    await expect(page.getByText('$1,500.00').first()).toBeVisible()
  })

  test('the billing page explains it and offers a plan', async ({ page }) => {
    await signIn(page, expiredOrg.email, expiredOrg.password)
    await page.goto('/settings/billing')

    await expect(
      page.getByRole('heading', { name: 'Your 14-day trial has ended' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Choose Mini' })).toBeVisible()
  })
})

// ===========================================================================
// A manager is kept away from billing entirely
// ===========================================================================

test.describe('billing belongs to the owner', () => {
  test('a manager gets an explanation, not a broken page', async ({ page }) => {
    await signIn(page, SEED_MANAGER.email, SEED_MANAGER.password)
    await page.goto('/settings/billing')

    await expect(page.getByText('Only the account owner can see billing')).toBeVisible()
    // No plan cards, no buttons that could only fail.
    await expect(page.getByRole('button', { name: /^Choose / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Manage billing on Stripe' })).toHaveCount(0)
    // And nothing raw leaked out on the way.
    await expect(page.getByText(/permission denied|PGRST|row-level security/i)).toHaveCount(0)
  })

  test('and is refused at the endpoint, not only in the interface', async ({ page }) => {
    // A button that is not rendered is not an access rule. The session is the
    // rule, and it says 403 for a manager.
    await signIn(page, SEED_MANAGER.email, SEED_MANAGER.password)
    const response = await page.request.post('/api/cron/stripe-reconcile')
    expect(response.status()).toBe(403)
  })
})

// ===========================================================================
// AC-S1 · the webhook
// ===========================================================================

interface WebhookBody {
  outcome?: string
  orgId?: string | null
  changed?: string[]
  reason?: string
  error?: string
}

function subscriptionEvent(options: {
  orgId: string
  status: string
  plan: 'mini' | 'standard' | 'pro'
  subId: string
  customerId: string
  periodEndUnix?: number
  type?: string
}): string {
  return JSON.stringify({
    id: `evt_${options.subId}`,
    object: 'event',
    type: options.type ?? 'customer.subscription.updated',
    data: {
      object: {
        id: options.subId,
        object: 'subscription',
        customer: options.customerId,
        status: options.status,
        metadata: { org_id: options.orgId },
        items: {
          data: [
            {
              id: 'si_1',
              current_period_end:
                options.periodEndUnix ?? Math.floor(Date.now() / 1000) + 30 * 86_400,
              price: { id: 'price_1', lookup_key: `rentease_${options.plan}_monthly` },
            },
          ],
        },
      },
    },
  })
}

/** Signs a payload the way Stripe does and posts it at the route. */
async function deliver(
  request: import('@playwright/test').APIRequestContext,
  payload: string,
  { secret = WEBHOOK_SECRET }: { secret?: string } = {},
): Promise<WebhookBody & { status: number }> {
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret })
  const response = await request.post('/api/webhooks/stripe', {
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    data: payload,
  })
  const body = (await response.json()) as WebhookBody
  return { ...body, status: response.status() }
}

test.describe('the Stripe webhook (AC-S1)', () => {
  test('refuses a payload that is not signed', async ({ request }) => {
    // The signature is the entire authentication on this endpoint — there is no
    // session behind a Stripe delivery.
    const response = await request.post('/api/webhooks/stripe', {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ type: 'customer.subscription.updated', data: { object: {} } }),
    })
    expect(response.status()).toBe(400)
  })

  test('refuses a payload signed with the wrong secret', async ({ request }) => {
    const result = await deliver(
      request,
      subscriptionEvent({
        orgId: trialOrg.orgId,
        status: 'active',
        plan: 'pro',
        subId: 'sub_forged',
        customerId: 'cus_forged',
      }),
      { secret: 'whsec_not_the_real_one' },
    )
    expect(result.status).toBe(400)

    // And changed nothing: the trial organization is still trialing.
    const { data } = await admin()
      .from('subscriptions')
      .select('status, plan')
      .eq('org_id', trialOrg.orgId)
      .single()
    expect(data).toMatchObject({ status: 'trialing', plan: 'mini' })
  })

  test('refuses a body that was altered after signing', async ({ request }) => {
    const honest = subscriptionEvent({
      orgId: trialOrg.orgId,
      status: 'active',
      plan: 'mini',
      subId: 'sub_tamper',
      customerId: 'cus_tamper',
    })
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload: honest,
      secret: WEBHOOK_SECRET,
    })
    const tampered = honest.replace('rentease_mini_monthly', 'rentease_pro_monthly')

    const response = await request.post('/api/webhooks/stripe', {
      headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
      data: tampered,
    })
    expect(response.status()).toBe(400)
  })

  test('acknowledges an event type it does not act on', async ({ request }) => {
    // Anything but a 2xx puts Stripe into a retry loop for days and eventually
    // disables the endpoint, so an ignored event is still a 200.
    const result = await deliver(
      request,
      JSON.stringify({
        id: 'evt_ignored',
        type: 'invoice.payment_succeeded',
        data: { object: { id: 'in_1' } },
      }),
    )
    expect(result.status).toBe(200)
    expect(result.outcome).toBe('ignored')
  })

  test('acknowledges an event for a customer no organization claims', async ({ request }) => {
    const result = await deliver(
      request,
      JSON.stringify({
        id: 'evt_orphan',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_orphan',
            customer: 'cus_nobody_here',
            status: 'active',
            metadata: {},
            items: { data: [] },
          },
        },
      }),
    )
    expect(result.status).toBe(200)
    expect(result.outcome).toBe('unknown-organization')
  })

  test('applies a subscription event, and applies it identically when Stripe resends', async ({
    request,
  }) => {
    const org = await freshOrgForWebhook()
    const payload = subscriptionEvent({
      orgId: org,
      status: 'active',
      plan: 'standard',
      subId: `sub_replay_${Date.now()}`,
      customerId: `cus_replay_${Date.now()}`,
      periodEndUnix: 1_800_000_000,
    })

    const first = await deliver(request, payload)
    expect(first.status).toBe(200)
    expect(first.outcome).toBe('applied')
    expect(first.orgId).toBe(org)

    const afterFirst = await readSubscription(org)
    expect(afterFirst).toMatchObject({ plan: 'standard', status: 'active' })
    expect(Date.parse(afterFirst.period_end as string)).toBe(1_800_000_000 * 1000)

    // Stripe retries until it gets a 2xx and re-sends events it has already
    // delivered. Twice must be indistinguishable from once.
    const second = await deliver(request, payload)
    const third = await deliver(request, payload)
    expect(second.outcome).toBe('applied')
    expect(third.outcome).toBe('applied')
    expect(await readSubscription(org)).toEqual(afterFirst)
  })

  test('a cancellation is recorded as cancelled whatever the payload still says', async ({
    request,
  }) => {
    const org = await freshOrgForWebhook()
    const subId = `sub_cancel_${Date.now()}`
    const customerId = `cus_cancel_${Date.now()}`

    await deliver(
      request,
      subscriptionEvent({ orgId: org, status: 'active', plan: 'pro', subId, customerId }),
    )

    // Stripe sends the object as it was — its status can still read 'active'.
    const deletion = JSON.parse(
      subscriptionEvent({
        orgId: org,
        status: 'active',
        plan: 'pro',
        subId,
        customerId,
        type: 'customer.subscription.deleted',
      }),
    ) as { data: { object: Record<string, unknown> } }
    deletion.data.object.ended_at = Math.floor(Date.now() / 1000)

    const result = await deliver(request, JSON.stringify(deletion))
    expect(result.outcome).toBe('applied')

    const row = await readSubscription(org)
    expect(row.status).toBe('canceled')
    // The customer id survives: a landlord who just cancelled is exactly who
    // needs the portal to restart.
    expect(row.stripe_customer_id).toBe(customerId)
  })

  test('an organization found only by its Stripe customer is still matched', async ({
    request,
  }) => {
    const org = await freshOrgForWebhook()
    const customerId = `cus_bymatch_${Date.now()}`

    await deliver(
      request,
      subscriptionEvent({
        orgId: org,
        status: 'active',
        plan: 'mini',
        subId: `sub_bymatch_${Date.now()}`,
        customerId,
      }),
    )

    // A second event carrying no org_id at all — a subscription started from
    // the Stripe dashboard looks like this.
    const anonymous = JSON.stringify({
      id: 'evt_anon',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: `sub_bymatch2_${Date.now()}`,
          customer: customerId,
          status: 'past_due',
          metadata: {},
          items: { data: [] },
        },
      },
    })

    const result = await deliver(request, anonymous)
    expect(result.outcome).toBe('applied')
    expect(result.orgId).toBe(org)
    expect((await readSubscription(org)).status).toBe('past_due')
  })
})

// ===========================================================================
// AC-S1 · the reconcile endpoint
// ===========================================================================

test.describe('the reconcile endpoint (AC-S1)', () => {
  test('refuses a caller with neither the cron secret nor a session', async ({ request }) => {
    expect((await request.post('/api/cron/stripe-reconcile')).status()).toBe(401)
    expect(
      (
        await request.post('/api/cron/stripe-reconcile', {
          headers: { Authorization: 'Bearer not-the-secret' },
        })
      ).status(),
    ).toBe(401)
  })

  test('accepts the cron secret and reports honestly when Stripe is not configured', async ({
    request,
  }) => {
    const response = await request.post('/api/cron/stripe-reconcile', {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    })

    // 503 on a server with no STRIPE_SECRET_KEY (D21 — the whole suite runs
    // that way), 200 once one is configured. Both are correct answers; a 500 or
    // a silent 200 claiming success would not be.
    expect([200, 503]).toContain(response.status())
    const body = (await response.json()) as { error?: string; scope?: string }
    if (response.status() === 503) {
      expect(body.error).toContain('Stripe is not configured')
    } else {
      expect(body.scope).toBe('all')
    }
  })

  test('an owner reconciles their own organization and nobody else’s', async ({ page }) => {
    await signIn(page, trialOrg.email, trialOrg.password)
    const response = await page.request.post('/api/cron/stripe-reconcile')
    expect([200, 503]).toContain(response.status())
    if (response.status() === 200) {
      const body = (await response.json()) as { scope: string; checked: number }
      expect(body.scope).toBe('organization')
      // One organization: their own. Never the whole table.
      expect(body.checked).toBe(1)
    }
  })
})

// ===========================================================================
// helpers that need the fixtures above
// ===========================================================================

/** A unit's id, so a test can open it without depending on how the list renders. */
async function unitIdFor(orgId: string, code: string): Promise<string> {
  const { data, error } = await admin()
    .from('units')
    .select('id')
    .eq('org_id', orgId)
    .eq('code', code)
    .single()
  expect(error, `could not find unit ${code}: ${error?.message}`).toBeNull()
  return (data as { id: string }).id
}

async function readSubscription(orgId: string): Promise<{
  plan: string
  status: string
  period_end: string | null
  stripe_customer_id: string | null
  stripe_sub_id: string | null
}> {
  const { data, error } = await admin()
    .from('subscriptions')
    .select('plan, status, period_end, stripe_customer_id, stripe_sub_id')
    .eq('org_id', orgId)
    .single()
  expect(error, `reading the subscription failed: ${error?.message}`).toBeNull()
  return data as never
}

/**
 * An organization for a webhook test to write to, created straight in the
 * database.
 *
 * No browser, no signup: these tests are about what arrives from Stripe, and
 * the row it lands on is the only fixture they need. Created through the same
 * shape signup produces — trialing, with a deadline (D22).
 */
async function freshOrgForWebhook(): Promise<string> {
  const supabase = admin()
  const name = `Webhook Probe ${Date.now()}${Math.floor(Math.random() * 1000)}`

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .insert({ name })
    .select('id')
    .single()
  expect(orgError, `creating the probe organization failed: ${orgError?.message}`).toBeNull()

  const orgId = (org as { id: string }).id
  const { error: subError } = await supabase.from('subscriptions').insert({
    org_id: orgId,
    plan: 'mini',
    status: 'trialing',
    period_end: new Date(Date.now() + 14 * 86_400_000).toISOString(),
  })
  expect(subError, `creating the probe subscription failed: ${subError?.message}`).toBeNull()

  return orgId
}
