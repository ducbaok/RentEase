import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'

/**
 * Stream 2B — the daily reminder job (F6), driven end to end.
 *
 * Everything happens inside a BRAND-NEW organization created for the run, for
 * the same reason portfolio.spec does it: the reminder cron is global (it runs
 * as the service role and scans every org), so the only way to assert on exact
 * invoices across re-runs — without a database reset and without tripping over
 * the shared seed — is to make invoices this run owns and check their ids.
 *
 * The as_of dates are chosen to fall OUTSIDE every seeded invoice's reminder
 * window (the seed bills on day 5; this org bills on day 8), so the job under
 * test never sends about, nor re-dates, a seeded invoice. That is what keeps
 * the suite safe to run against the Supabase instance shared with stream 2A.
 *
 * What is proved here, against a real database and the real HTTP endpoint:
 *   AC6.2  running twice in a day sends nothing the second time.
 *   AC6.1  a fully-paid invoice is skipped — checked at send time.
 *   F6     the before-due and overdue windows actually fire.
 * The window arithmetic itself is proved exhaustively in tests/unit/reminders.
 */

const CRON_SECRET = readCronSecret()

// This org bills on day 8, so due dates are the 8th of the month after the
// period. The windows below therefore never coincide with the seed's day-5
// invoices, whose windows land on the 2nd/6th/12th.
const JULY = '2026-07' // due 2026-08-08 → overdue_1 window 2026-08-09
const AUGUST = '2026-08' // due 2026-09-08 → before_due window 2026-09-05
const OVERDUE_1_DAY = '2026-08-09'
const BEFORE_DUE_DAY = '2026-09-05'

function readCronSecret(): string {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET
  if (existsSync('.env.local')) {
    const match = readFileSync('.env.local', 'utf8').match(/^\s*CRON_SECRET\s*=\s*(.+?)\s*$/m)
    if (match?.[1]) return match[1].replace(/^["']|["']$/g, '')
  }
  throw new Error('CRON_SECRET is not set — the reminder endpoint cannot be tested without it.')
}

interface JobSummary {
  asOf: string
  refreshedOverdue: number
  considered: number
  sent: Array<{ invoiceId: string; kind: string }>
  duplicates: number
  skippedNoRecipient: number
  failed: Array<{ invoiceId: string; kind: string; error: string }>
}

async function runJob(request: APIRequestContext, asOf: string): Promise<JobSummary> {
  const response = await request.get(`/api/cron/reminders?as_of=${asOf}`, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  })
  expect(response.status(), await response.text()).toBe(200)
  return (await response.json()) as JobSummary
}

function sentKind(summary: JobSummary, invoiceId: string): string | undefined {
  return summary.sent.find((entry) => entry.invoiceId === invoiceId)?.kind
}

async function signUpFreshLandlord(page: Page): Promise<string> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const orgName = `Reminders Test ${stamp}`
  await page.goto('/sign-up')
  await page.getByLabel('Email').fill(`reminders-${stamp}@example.test`)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/sign-up\/organization/)
  await page.getByLabel('Business name').fill(orgName)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
  return orgName
}

async function createProperty(page: Page, name: string) {
  await page.goto('/properties/new')
  await page.getByLabel('Property name').fill(name)
  await page.getByRole('button', { name: 'Create property' }).click()
  await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/)
}

async function createUnit(page: Page, code: string, rent: string) {
  await page.goto('/units/new')
  await page.getByLabel('Unit code').fill(code)
  await page.getByLabel('Default rent').fill(rent)
  await page.getByRole('button', { name: 'Create unit' }).click()
  await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}$/)
}

async function createTenant(page: Page, name: string, email: string) {
  await page.goto('/tenants/new')
  await page.getByLabel('Full name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Create resident' }).click()
  await expect(page).toHaveURL(/\/tenants\/[0-9a-f-]{36}$/)
}

/**
 * Leases a unit to a resident, both chosen by option index, from 2026-01-01.
 * The Resident option label is "Name (email)", so it is picked by position —
 * tenants are listed alphabetically by name.
 */
async function createLease(page: Page, unitIndex: number, residentIndex: number) {
  await page.goto('/leases/new')
  await page.getByLabel('Unit').selectOption({ index: unitIndex })
  await page.getByLabel('Resident').selectOption({ index: residentIndex })
  await page.getByLabel('Start date').fill('2026-01-01')
  await page.getByLabel('Billing day').fill('8')
  await page.getByLabel('Deposit').fill('1000')
  await page.getByRole('button', { name: 'Create lease' }).click()
  await expect(page).toHaveURL(/\/leases\/[0-9a-f-]{36}$/)
}

async function createTariff(page: Page) {
  await page.goto('/tariffs')
  await page.getByLabel('Rates start on').fill('2026-01-01')
  await page.getByLabel('Service fee per month ($)').fill('25.00')
  await page.getByLabel('Electricity ($ per kWh)').fill('0.14')
  await page.getByLabel('Water ($ per gal)').fill('0.012')
  await page.getByRole('button', { name: 'Save rates' }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Jan 1, 2026' })).toBeVisible()
}

async function issuePeriod(page: Page, period: string) {
  await page.goto(`/invoices/issue?period=${period}`)
  await page.getByRole('button', { name: /^Issue \d+ invoice/ }).click()
  await expect(page.getByText(new RegExp(`Issued \\d+ invoice(s)? for ${period}`))).toBeVisible()
}

/** The invoice id for a resident in a period, read from the detail-page URL. */
async function invoiceIdFor(page: Page, period: string, residentName: string): Promise<string> {
  await page.goto(`/invoices?period=${period}`)
  await page.getByRole('row').filter({ hasText: residentName }).getByRole('link').first().click()
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/)
  const id = page.url().match(/\/invoices\/([0-9a-f-]{36})$/)?.[1]
  expect(id, 'could not read invoice id from the detail URL').toBeTruthy()
  return id as string
}

async function payInFull(page: Page, invoiceId: string, amount: string) {
  await page.goto(`/invoices/${invoiceId}`)
  await page.getByLabel('Amount received ($)').fill(amount)
  await page.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByText(/Payment recorded/)).toBeVisible()
  await page.reload()
  await expect(page.getByText('Paid').first()).toBeVisible()
}

// Ada is never paid — she is who the reminders are about. Ben pays up front —
// he is who they must skip. Each invoice is $1,000 rent + $25 service = $1,025.
const ADA = 'Ada Owes'
const BEN = 'Ben Paid'

let adaJuly = ''
let adaAugust = ''
let benJuly = ''

test.beforeAll(async ({ browser }) => {
  test.slow()
  const page = await browser.newPage()

  await signUpFreshLandlord(page)
  await createProperty(page, 'Reminder Court')
  await createUnit(page, '101', '1000.00')
  await createUnit(page, '102', '1000.00')
  await createTariff(page)

  const stamp = `${Date.now()}`
  await createTenant(page, ADA, `ada-${stamp}@example.test`)
  await createTenant(page, BEN, `ben-${stamp}@example.test`)

  // Unit 101 → Ada, unit 102 → Ben. Tenants are alphabetical, so Ada is
  // resident index 0 and Ben index 1; units stay listed after being let.
  await createLease(page, 0, 0)
  await createLease(page, 1, 1)

  await issuePeriod(page, JULY)
  await issuePeriod(page, AUGUST)

  adaJuly = await invoiceIdFor(page, JULY, ADA)
  adaAugust = await invoiceIdFor(page, AUGUST, ADA)
  benJuly = await invoiceIdFor(page, JULY, BEN)

  // Ben settles July in full before any reminder could go out.
  await payInFull(page, benJuly, '1025.00')

  await page.close()
})

test('the endpoint refuses a request without the shared secret', async ({ request }) => {
  const noSecret = await request.get(`/api/cron/reminders?as_of=${OVERDUE_1_DAY}`)
  expect(noSecret.status()).toBe(401)

  const wrongSecret = await request.get(`/api/cron/reminders?as_of=${OVERDUE_1_DAY}`, {
    headers: { Authorization: 'Bearer not-the-secret' },
  })
  expect(wrongSecret.status()).toBe(401)
})

test('AC6.1 / AC6.2: an overdue invoice is chased once, a paid one never, and a re-run is silent', async ({
  request,
}) => {
  // --- first run, on the overdue_1 window for July's due date -------------
  const first = await runJob(request, OVERDUE_1_DAY)

  // Ada's July invoice is one day past due → chased with overdue_1.
  expect(sentKind(first, adaJuly)).toBe('overdue_1')
  // Ben paid in full → never chased, even though his invoice is in the window.
  expect(sentKind(first, benJuly)).toBeUndefined()
  // August is not due yet — its window is weeks away.
  expect(sentKind(first, adaAugust)).toBeUndefined()

  // --- second run, same day → idempotent (AC6.2) -------------------------
  const second = await runJob(request, OVERDUE_1_DAY)
  expect(sentKind(second, adaJuly)).toBeUndefined()
  expect(second.sent.some((e) => e.invoiceId === adaJuly)).toBe(false)
  // The reminder it did not re-send is accounted for as a duplicate.
  expect(second.duplicates).toBeGreaterThanOrEqual(1)
})

test('F6: the before-due window fires three days ahead of the due date', async ({ request }) => {
  const summary = await runJob(request, BEFORE_DUE_DAY)
  // August's due date is 2026-09-08; three days before is today's as_of.
  expect(sentKind(summary, adaAugust)).toBe('before_due')
  // July was already handled in the overdue window and is not before-due now.
  expect(sentKind(summary, adaJuly)).toBeUndefined()
})
