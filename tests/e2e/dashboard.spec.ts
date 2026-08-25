import { test, expect, type Page } from '@playwright/test'

/**
 * Stream 2B — the operator dashboard (AC-D1).
 *
 * Like portfolio.spec, every run builds a BRAND-NEW organization and asserts
 * only on the data it created there. That is what makes the numbers exact: the
 * dashboard sums money and counts occupancy over one org, so a fresh org means
 * "$500 collected", "50% occupied" and "1 unit past due" mean precisely that,
 * every run, with no database reset and immune to what stream 2A is doing next
 * door.
 *
 * The org is shaped so all four AC-D1 sections have something definite to show:
 *   - two units, one leased  → occupancy 50%
 *   - a current-month invoice, part-paid → collected vs outstanding
 *   - an older, unpaid invoice → one unit past due
 *   - the lease ends within 30 days → one lease ending soon
 */

// The machine clock these tests run against is 2026-08, so the current billing
// period is 2026-08 and "this month" on the dashboard means it.
const THIS_PERIOD = '2026-08' // invoice due 2026-09-08 → still 'sent'
const OLD_PERIOD = '2026-06' // invoice due 2026-07-08 → already overdue
const TENANT = 'Cora Dash'

function daysFromToday(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

async function signUpFreshLandlord(page: Page): Promise<string> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const orgName = `Dashboard Test ${stamp}`
  await page.goto('/sign-up')
  await page.getByLabel('Email').fill(`dashboard-${stamp}@example.test`)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/sign-up\/organization/)
  await page.getByLabel('Business name').fill(orgName)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
  return orgName
}

async function invoiceIdFor(page: Page, period: string, residentName: string): Promise<string> {
  await page.goto(`/invoices?period=${period}`)
  await page.getByRole('row').filter({ hasText: residentName }).getByRole('link').first().click()
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/)
  const id = page.url().match(/\/invoices\/([0-9a-f-]{36})$/)?.[1]
  expect(id).toBeTruthy()
  return id as string
}

test('AC-D1: the overview reports collected, outstanding, occupancy, overdue and expiring', async ({
  page,
}) => {
  test.slow()
  await signUpFreshLandlord(page)

  // --- a building with two units, only one of which is let ---------------
  await page.goto('/properties/new')
  await page.getByLabel('Property name').fill('Dash Court')
  await page.getByRole('button', { name: 'Create property' }).click()
  await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/)

  for (const code of ['201', '202']) {
    await page.goto('/units/new')
    await page.getByLabel('Unit code').fill(code)
    await page.getByLabel('Default rent').fill('1000.00')
    await page.getByRole('button', { name: 'Create unit' }).click()
    await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}$/)
  }

  await page.goto('/tariffs')
  await page.getByLabel('Rates start on').fill('2026-01-01')
  await page.getByLabel('Service fee per month ($)').fill('25.00')
  await page.getByLabel('Electricity ($ per kWh)').fill('0.14')
  await page.getByLabel('Water ($ per gal)').fill('0.012')
  await page.getByRole('button', { name: 'Save rates' }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Jan 1, 2026' })).toBeVisible()

  await page.goto('/tenants/new')
  await page.getByLabel('Full name').fill(TENANT)
  await page.getByLabel('Email').fill(`cora-${Date.now()}@example.test`)
  await page.getByRole('button', { name: 'Create resident' }).click()
  await expect(page).toHaveURL(/\/tenants\/[0-9a-f-]{36}$/)

  // Unit 201 (index 0) is let to Cora; the lease ends within 30 days so it
  // lands in the "ending soon" list. Unit 202 stays vacant → 50% occupancy.
  await page.goto('/leases/new')
  await page.getByLabel('Unit').selectOption({ index: 0 })
  // Only one resident exists, and the option label is "Name (email)" — pick it
  // by position rather than an exact label match.
  await page.getByLabel('Resident').selectOption({ index: 0 })
  await page.getByLabel('Start date').fill('2026-01-01')
  await page.getByLabel('End date').fill(daysFromToday(20))
  await page.getByLabel('Billing day').fill('8')
  await page.getByLabel('Deposit').fill('1000')
  await page.getByRole('button', { name: 'Create lease' }).click()
  await expect(page).toHaveURL(/\/leases\/[0-9a-f-]{36}$/)

  // --- two invoices: one overdue (June), one current and part-paid -------
  await page.goto(`/invoices/issue?period=${OLD_PERIOD}`)
  await page.getByRole('button', { name: /^Issue \d+ invoice/ }).click()
  await expect(page.getByText(new RegExp(`Issued \\d+ invoice(s)? for ${OLD_PERIOD}`))).toBeVisible()

  await page.goto(`/invoices/issue?period=${THIS_PERIOD}`)
  await page.getByRole('button', { name: /^Issue \d+ invoice/ }).click()
  await expect(page.getByText(new RegExp(`Issued \\d+ invoice(s)? for ${THIS_PERIOD}`))).toBeVisible()

  // Part-pay the current invoice: $500 of the $1,025 due.
  const currentInvoice = await invoiceIdFor(page, THIS_PERIOD, TENANT)
  await page.goto(`/invoices/${currentInvoice}`)
  await page.getByLabel('Amount received ($)').fill('500.00')
  await page.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByText(/Payment recorded/)).toBeVisible()

  // --- the dashboard, section by section ---------------------------------
  await page.goto('/dashboard')

  // Money is scoped to the current period (2026-08): $1,025 billed, $500 in.
  await expect(page.getByTestId('dash-collected')).toHaveText('$500.00')
  await expect(page.getByTestId('dash-outstanding')).toHaveText('$525.00')

  // Occupancy: one of two units let.
  await expect(page.getByTestId('dash-occupancy-percent')).toHaveText('50%')
  await expect(page.getByTestId('dash-occupancy-occupied')).toHaveText('1')
  await expect(page.getByTestId('dash-occupancy-total')).toHaveText('2')

  // The June invoice is past due → exactly one unit to chase, and it is 201.
  await expect(page.getByTestId('dash-overdue-count')).toHaveText('1')
  const overdue = page.getByTestId('dash-overdue-list')
  await expect(overdue.getByRole('row')).toHaveCount(1)
  await expect(overdue).toContainText('201')
  await expect(overdue).toContainText('$1,025.00')

  // The lease ends within 30 days → one lease ending soon, unit 201.
  const expiring = page.getByTestId('dash-expiring-list')
  await expect(expiring.getByRole('row')).toHaveCount(1)
  await expect(expiring).toContainText('201')
  await expect(expiring).toContainText(TENANT)
})
