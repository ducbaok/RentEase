import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'

/**
 * Stream 3B — the product back office, the change history and the demo reset.
 *
 * THREE THINGS ARE BEING PROVED, AND ONLY ONE OF THEM IS A FEATURE.
 *
 *   1. A super admin can see the account list (D11/D12).
 *   2. Nobody else can — and an operator or resident who asks for /admin by URL
 *      is turned away by the server, not by a missing link. proxy.ts is
 *      explicitly not a security boundary (20-architecture.md), so the guard
 *      being tested is the one in the layout and in the query.
 *   3. The nightly demo reset is idempotent: running it twice leaves the
 *      database in the state one run leaves it in (D23).
 *
 * WHY THIS FILE MAY ASSERT INVOICE STATUSES AND OTHERS MAY NOT
 * The reminder cron re-derives every invoice's status for whatever `as_of` it
 * is called with, across every organization in the shared local database, so an
 * assertion about "the demo has an overdue invoice" would normally be measuring
 * whichever suite ran last. It is safe here because this file performs the
 * reset itself, on the line above the assertion: the data is re-anchored to
 * today by that request. Running this file alone, after anything else,
 * re-anchors it again.
 *
 * WHY THE CHANGE-HISTORY TESTS BUILD THEIR OWN ORGANIZATION
 * They have to correct an invoice, and a correction is permanent. Correcting a
 * seeded one would rewrite a figure billing.spec asserts to the cent — from the
 * file that happens to run first, alphabetically, which is the worst possible
 * place to hide that. A fresh organization per run costs a minute and cannot
 * reach anyone else's data.
 *
 * Fixture: supabase/seed.sql. Run `pnpm db:reset` before this suite.
 */

const CRON_SECRET = readCronSecret()

const SEED = {
  superAdmin: { email: 'super@rentease.test', password: 'password123' },
  ownerA: { email: 'alice@northside.test', password: 'password123', org: 'Northside Rentals' },
  ownerB: { email: 'bob@lakeview.test', password: 'password123', org: 'Lakeview Property Group' },
  managerA: { email: 'mike@northside.test', password: 'password123' },
  residentA: { email: 'dana@resident.test', password: 'password123' },
  demoOwner: { email: 'demo-owner@example.com', password: 'password123' },
}

const DEMO_ORG = 'Riverbend Residential (demo)'
/** A seeded invoice belonging to org A — the one a super admin must not reach. */
const ORG_A_INVOICE = 'a0000000-0000-4000-8000-000000000050'

function readCronSecret(): string {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET
  if (existsSync('.env.local')) {
    const match = readFileSync('.env.local', 'utf8').match(/^\s*CRON_SECRET\s*=\s*(.+?)\s*$/m)
    if (match?.[1]) return match[1].replace(/^["']|["']$/g, '')
  }
  throw new Error('CRON_SECRET is not set — the demo-reset endpoint cannot be tested without it.')
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'))
}

interface ResetSummary {
  anchor: string
  orgId: string
  deleted: Record<string, number>
  inserted: Record<string, number>
  operatorAccountsPresent: boolean
  notes: string[]
}

async function resetDemo(request: APIRequestContext): Promise<ResetSummary> {
  const response = await request.post('/api/cron/demo-reset', {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  })
  expect(response.status(), await response.text()).toBe(200)
  return (await response.json()) as ResetSummary
}

/** 'YYYY-MM' for today and for the month before — the demo's two newest periods. */
function periods(): { current: string; previous: string } {
  const now = new Date()
  const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const before = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const previous = `${before.getUTCFullYear()}-${String(before.getUTCMonth() + 1).padStart(2, '0')}`
  return { current, previous }
}

// ===========================================================================
// The back office
// ===========================================================================

test.describe('the product back office', () => {
  test('a super admin lands on the account list and sees every organization', async ({ page }) => {
    await signIn(page, SEED.superAdmin.email, SEED.superAdmin.password)
    await expect(page).toHaveURL(/\/admin/)

    const list = page.getByTestId('admin-org-list')
    await expect(list).toContainText(SEED.ownerA.org)
    await expect(list).toContainText(SEED.ownerB.org)
    await expect(list).toContainText(DEMO_ORG)
  })

  test('the account list shows subscription state, not the books', async ({ page }) => {
    await signIn(page, SEED.superAdmin.email, SEED.superAdmin.password)

    await expect(page.getByRole('row').filter({ hasText: DEMO_ORG })).toContainText('Active')

    // The two super policies reach organizations and subscriptions and nothing
    // else, so no unit code, resident or invoice figure can appear here. Cedar
    // Court is org A's building; its absence is the guarantee, not an oversight.
    await expect(page.getByText('Cedar Court')).toHaveCount(0)
    await expect(page.getByText('Dana Whitfield')).toHaveCount(0)
  })

  test('a super admin who asks for the operator app is sent back to the back office', async ({
    page,
  }) => {
    await signIn(page, SEED.superAdmin.email, SEED.superAdmin.password)

    // IDOR path 1 — a deep link, not a navigation. A super admin has no
    // organization, so RLS would return nothing anyway; this proves they are
    // turned away before ever asking.
    await page.goto(`/invoices/${ORG_A_INVOICE}`)
    await expect(page).toHaveURL(/\/admin/)

    await page.goto('/invoices/audit')
    await expect(page).toHaveURL(/\/admin/)

    await page.goto('/portal')
    await expect(page).toHaveURL(/\/admin/)
  })
})

test.describe('the back office is closed to everyone else', () => {
  test('an owner asking for /admin is sent to their dashboard', async ({ page }) => {
    // IDOR path 2.
    await signIn(page, SEED.ownerA.email, SEED.ownerA.password)
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByText(SEED.ownerB.org)).toHaveCount(0)
  })

  test('a manager asking for /admin is sent to their dashboard', async ({ page }) => {
    await signIn(page, SEED.managerA.email, SEED.managerA.password)
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('a resident asking for /admin is sent to the portal', async ({ page }) => {
    // IDOR path 3.
    await signIn(page, SEED.residentA.email, SEED.residentA.password)
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/portal/)
  })

  test('a signed-out visitor asking for /admin is sent to sign in', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/sign-in/)
  })
})

// ===========================================================================
// The 404 contract — a regression guard for THIS stream's loading skeletons
// ===========================================================================

test.describe('an unreachable record answers 404, not 200', () => {
  test('a missing invoice id returns a real 404 status', async ({ page }) => {
    await signIn(page, SEED.ownerA.email, SEED.ownerA.password)

    // Stream 3B added loading.tsx skeletons, and a loading.tsx makes Next stream
    // the segment beneath it: HTTP 200 and the shell go out BEFORE the page runs,
    // so a later notFound() can no longer set the status. Put one above a [id]
    // route and every "you cannot see this row" 404 silently becomes a 200.
    //
    // portfolio.spec and portal.spec both assert that 404 as the outcome of a
    // guessed id, which is how this was caught. The guard is repeated here so it
    // fails in the suite belonging to the stream that owns the risk, rather than
    // only in two files owned by other streams.
    const response = await page.goto('/invoices/00000000-0000-4000-8000-0000000000ff')
    expect(response?.status()).toBe(404)
  })
})

// ===========================================================================
// The change history (AC5.2), in an organization this run owns
// ===========================================================================

const CORRECTION_REASON = 'Agreed reduction for the week without hot water'
const AUDIT_PERIOD = '2026-06'
const AUDIT_TENANT = 'Nora Ledger'

let auditOrgName = ''

async function buildAuditOrg(page: Page): Promise<void> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  auditOrgName = `Audit Test ${stamp}`

  await page.goto('/sign-up')
  await page.getByLabel('Email').fill(`audit-${stamp}@example.test`)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/sign-up\/organization/)
  await page.getByLabel('Business name').fill(auditOrgName)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/properties/new')
  await page.getByLabel('Property name').fill('Ledger House')
  await page.getByRole('button', { name: 'Create property' }).click()
  await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/)

  await page.goto('/units/new')
  await page.getByLabel('Unit code').fill('301')
  await page.getByLabel('Default rent').fill('1000.00')
  await page.getByRole('button', { name: 'Create unit' }).click()
  await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}$/)

  await page.goto('/tariffs')
  await page.getByLabel('Rates start on').fill('2026-01-01')
  await page.getByLabel('Service fee per month ($)').fill('25.00')
  await page.getByLabel('Electricity ($ per kWh)').fill('0.14')
  await page.getByLabel('Water ($ per gal)').fill('0.012')
  await page.getByRole('button', { name: 'Save rates' }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Jan 1, 2026' })).toBeVisible()

  await page.goto('/tenants/new')
  await page.getByLabel('Full name').fill(AUDIT_TENANT)
  await page.getByLabel('Email').fill(`nora-${stamp}@example.test`)
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

  await page.goto(`/invoices/issue?period=${AUDIT_PERIOD}`)
  await page.getByRole('button', { name: /^Issue \d+ invoice/ }).click()
  await expect(
    page.getByText(new RegExp(`Issued \\d+ invoice(s)? for ${AUDIT_PERIOD}`)),
  ).toBeVisible()
}

test.describe('the change history', () => {
  test('a correction shows up with who made it, what moved and why', async ({ page }) => {
    test.slow()
    await buildAuditOrg(page)

    // --- correct the invoice ------------------------------------------------
    await page.goto(`/invoices?period=${AUDIT_PERIOD}`)
    await page.getByRole('row').filter({ hasText: AUDIT_TENANT }).getByRole('link').first().click()
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/)

    await page.getByRole('button', { name: 'Correct this invoice' }).click()
    await page.getByLabel('Rent ($)').fill('900.00')
    await page.getByLabel('Why (recorded in the history)').fill(CORRECTION_REASON)
    await page.getByRole('button', { name: 'Save change' }).click()
    await expect(page.getByText('Invoice updated. The change is in the history below.')).toBeVisible()

    // --- and read it back off the history screen ---------------------------
    await page.goto('/invoices')
    await page.getByRole('link', { name: 'Change history' }).click()
    await expect(page).toHaveURL(/\/invoices\/audit/)

    const list = page.getByTestId('audit-list')
    await expect(list).toContainText(CORRECTION_REASON)
    await expect(list).toContainText('Invoice')
    await expect(list).toContainText('Changed')
    // Old value → new value, in money rather than in cents.
    await expect(list).toContainText('$1,000.00')
    await expect(list).toContainText('$900.00')
    // Who: this org's only operator, the account that just signed up.
    await expect(list).toContainText('audit-')

    // Filters narrow to the closed vocabulary from 30-data-model.md.
    await page.goto('/invoices/audit?entity=payment')
    await expect(page.getByText('Nothing matches this filter')).toBeVisible()

    await page.goto('/invoices/audit?entity=invoice&action=update')
    await expect(page.getByTestId('audit-list')).toContainText(CORRECTION_REASON)

    // A hand-edited filter is dropped rather than passed to a query, so this is
    // the unfiltered view and the entry is still there.
    await page.goto('/invoices/audit?entity=organizations&action=drop')
    await expect(page.getByTestId('audit-list')).toContainText(CORRECTION_REASON)
  })

  test('another landlord cannot see that correction', async ({ page }) => {
    // audit_logs is org-scoped by policy; this is that policy, through the UI.
    await signIn(page, SEED.ownerA.email, SEED.ownerA.password)
    await page.goto('/invoices/audit')
    await expect(page.getByText(CORRECTION_REASON)).toHaveCount(0)
  })

  test('a resident cannot reach it at all', async ({ page }) => {
    await signIn(page, SEED.residentA.email, SEED.residentA.password)
    await page.goto('/invoices/audit')
    await expect(page).toHaveURL(/\/portal/)
  })
})

// ===========================================================================
// The demo organization (D23)
// ===========================================================================

test.describe('the demo reset', () => {
  test('the endpoint refuses a request without the shared secret', async ({ request }) => {
    const noSecret = await request.post('/api/cron/demo-reset')
    expect(noSecret.status()).toBe(401)

    const wrongSecret = await request.post('/api/cron/demo-reset', {
      headers: { Authorization: 'Bearer not-the-secret' },
    })
    expect(wrongSecret.status()).toBe(401)
  })

  test('running it twice leaves the same state as running it once', async ({ request }) => {
    test.slow()
    const first = await resetDemo(request)
    const second = await resetDemo(request)

    // The same rows are written both times — same tables, same counts.
    expect(second.inserted).toEqual(first.inserted)

    // And the second run cleared exactly what the first one wrote. Together
    // these say the reset is a fixed point: the state after two runs is the
    // state after one.
    for (const [table, written] of Object.entries(first.inserted)) {
      expect(second.deleted[table] ?? 0, `${table} was written but not cleared`).toBe(written)
    }

    expect(first.operatorAccountsPresent, first.notes.join(' ')).toBe(true)
    expect(first.notes).toEqual([])
  })

  test('it does not touch any other organization', async ({ page, request }) => {
    await resetDemo(request)

    // The reset runs as service role, which bypasses RLS entirely — nothing but
    // its own `org_id` filter (D23 constraint 3) stands between it and everyone
    // else's data. So the check is: org A's seeded portfolio is still there.
    await signIn(page, SEED.ownerA.email, SEED.ownerA.password)
    await page.goto('/properties')
    await expect(page.getByText('Cedar Court')).toBeVisible()
    await page.goto('/units')
    for (const code of ['101', '102', '103']) {
      await expect(page.getByRole('row').filter({ hasText: code }).first()).toBeVisible()
    }
  })

  test('the demo owner signs in to a portfolio with all four invoice statuses', async ({
    page,
    request,
  }) => {
    test.slow()
    await resetDemo(request)
    await signIn(page, SEED.demoOwner.email, SEED.demoOwner.password)
    await expect(page).toHaveURL(/\/dashboard/)

    // Thirteen units, eleven let — a real occupancy figure, not a tidy 100%.
    await expect(page.getByTestId('dash-occupancy-total')).toHaveText('13')
    await expect(page.getByTestId('dash-occupancy-occupied')).toHaveText('11')

    // Somebody is behind on the rent, which is what the product is for.
    const overdue = await page.getByTestId('dash-overdue-count').textContent()
    expect(Number(overdue)).toBeGreaterThan(0)

    const { current, previous } = periods()

    // This month's bills are not due yet: issued, some part-paid, one settled.
    await page.goto(`/invoices?period=${current}`)
    await expect(page.getByText('Sent').first()).toBeVisible()
    await expect(page.getByText('Partially paid').first()).toBeVisible()
    await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible()

    // Last month's are past due, and some were never settled.
    await page.goto(`/invoices?period=${previous}`)
    await expect(page.getByText('Overdue').first()).toBeVisible()
  })

  test('no demo resident has an address that could receive real mail', async ({ page, request }) => {
    await resetDemo(request)
    await signIn(page, SEED.demoOwner.email, SEED.demoOwner.password)
    await page.goto('/tenants')

    // D23 constraint 1. The reminder job runs nightly across every organization,
    // so a demo resident with a deliverable address would be emailed invented
    // arrears every night, forever. @example.com is reserved (RFC 2606).
    const cells = await page.locator('table tbody td').allTextContents()
    const addresses = cells
      .map((text) => text.match(/[\w.+-]+@[\w.-]+/)?.[0])
      .filter((address): address is string => Boolean(address))

    expect(addresses.length).toBeGreaterThan(0)
    for (const address of addresses) {
      expect(address.endsWith('@example.com'), address).toBe(true)
    }
  })
})
