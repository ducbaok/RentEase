import { test, expect, type Page } from '@playwright/test'

/**
 * Stream 1A — the asset tree and the lease lifecycle, driven the way a
 * landlord drives it (F1, F2).
 *
 * Every run signs up a BRAND NEW landlord and works only inside that
 * organization. That is not ceremony: occupancy is a percentage of whatever
 * units exist, so a test that shared the seed fixture would assert numbers
 * that drift as other suites add rows. A fresh organization means 0%, 50% and
 * 100% mean exactly what they say, every time, without a database reset
 * between runs.
 *
 * The seeded organizations are still used — as the thing this landlord must
 * not be able to reach.
 */

const SEED = {
  propertyIdA: 'a0000000-0000-4000-8000-000000000100',
  unitIdA: 'a0000000-0000-4000-8000-000000000101',
  propertyNameA: 'Cedar Court',
  residentNameA: 'Dana Whitfield',
}

function formAlert(page: Page) {
  // Next renders its own role="alert" route announcer once hydrated, so form
  // errors are always scoped to the form that produced them.
  return page.locator('form').getByRole('alert')
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysFromToday(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Signs up a landlord with an empty organization and returns its name. */
async function signUpFreshLandlord(page: Page): Promise<string> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const orgName = `Portfolio Test ${stamp}`

  await page.goto('/sign-up')
  await page.getByLabel('Email').fill(`portfolio-${stamp}@example.test`)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/sign-up\/organization/)
  await page.getByLabel('Business name').fill(orgName)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  return orgName
}

async function expectOccupancy(
  page: Page,
  expected: { percent: number; occupied: number; vacant: number },
) {
  await page.goto('/units')
  await expect(page.getByTestId('occupancy-percent')).toHaveText(`${expected.percent}%`)
  await expect(page.getByTestId('occupancy-occupied')).toHaveText(String(expected.occupied))
  await expect(page.getByTestId('occupancy-vacant')).toHaveText(String(expected.vacant))
}

test.describe('the asset tree', () => {
  test('a landlord sets up a building, its units, a resident and a lease', async ({ page }) => {
    test.slow()
    await signUpFreshLandlord(page)

    // --- F1: the property -------------------------------------------------
    await page.goto('/properties')
    await page.getByRole('link', { name: 'Add your first property' }).click()
    await page.getByLabel('Property name').fill('Alder Yard')
    await page.getByLabel('Address').fill('9 Alder Rd, Austin, TX')
    await page.getByRole('button', { name: 'Create property' }).click()

    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/)
    const propertyUrl = page.url()
    await expect(page.getByRole('heading', { name: 'Alder Yard' })).toBeVisible()

    // --- F1: two units ----------------------------------------------------
    await page.getByRole('link', { name: 'Add the first unit' }).click()
    await page.getByLabel('Unit code').fill('101')
    await page.getByLabel('Size').fill('55')
    await page.getByLabel('Default rent').fill('1200.00')
    await page.getByRole('button', { name: 'Create unit' }).click()

    await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}$/)
    await expect(page.getByText('Vacant').first()).toBeVisible()
    await expect(page.getByText('$1,200.00')).toBeVisible()

    await page.goto(propertyUrl)
    await page.getByRole('link', { name: 'Add unit' }).click()
    await page.getByLabel('Unit code').fill('102')
    await page.getByLabel('Default rent').fill('1050')
    await page.getByRole('button', { name: 'Create unit' }).click()
    await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}$/)
    const unit102Url = page.url()

    // AC1.2 — the same code again in the same building is refused.
    await page.goto(propertyUrl)
    await page.getByRole('link', { name: 'Add unit' }).click()
    await page.getByLabel('Unit code').fill('101')
    await page.getByLabel('Default rent').fill('900')
    await page.getByRole('button', { name: 'Create unit' }).click()
    await expect(formAlert(page)).toContainText('already exists in this property')
    await expect(page).toHaveURL(/\/units\/new/)

    // --- AC1.1: occupancy moves the moment a unit does --------------------
    await expectOccupancy(page, { percent: 0, occupied: 0, vacant: 2 })

    await page.goto(`${unit102Url}/edit`)
    await page.getByLabel('Occupancy').selectOption('occupied')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page).toHaveURL(unit102Url)
    await expectOccupancy(page, { percent: 50, occupied: 1, vacant: 1 })

    await page.goto(`${unit102Url}/edit`)
    await page.getByLabel('Occupancy').selectOption('vacant')
    await page.getByRole('button', { name: 'Save changes' }).click()
    // Wait for the redirect before navigating on, or the next page load races
    // the write that it is supposed to be reading.
    await expect(page).toHaveURL(unit102Url)
    await expectOccupancy(page, { percent: 0, occupied: 0, vacant: 2 })

    // --- F1: the resident -------------------------------------------------
    await page.goto('/tenants')
    await page.getByRole('link', { name: 'Add your first resident' }).click()
    await page.getByLabel('Full name').fill('Robin Vega')
    await page.getByLabel('Email').fill(`robin-${Date.now()}@example.test`)
    await page.getByRole('button', { name: 'Create resident' }).click()
    await expect(page).toHaveURL(/\/tenants\/[0-9a-f-]{36}$/)
    await expect(page.getByText('Not invited yet')).toBeVisible()

    // --- F2: the lease ----------------------------------------------------
    await page.goto('/leases')
    await page.getByRole('link', { name: 'Create the first lease' }).click()

    // Units are listed property-then-code, so index 0 is unit 101.
    await page.getByLabel('Unit').selectOption({ index: 0 })
    await page.getByLabel('Start date').fill(today())
    await page.getByLabel('Billing day').fill('5')
    // The rent came from the unit's default the moment the unit was chosen.
    await expect(page.getByLabel('Monthly rent')).toHaveValue('1200.00')
    await page.getByLabel('Deposit').fill('1200')
    await page.getByRole('button', { name: 'Create lease' }).click()

    await expect(page).toHaveURL(/\/leases\/[0-9a-f-]{36}$/)
    const leaseUrl = page.url()
    await expect(page.getByText('Current')).toBeVisible()
    await expect(page.getByText('Day 5 of the month')).toBeVisible()

    // AC2.2 — the unit followed the lease without anyone touching its status.
    await page.getByRole('link', { name: 'Open unit' }).click()
    await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}$/)
    await expect(page.getByText('Let to Robin Vega.')).toBeVisible()
    await expect(page.getByText('Occupied').first()).toBeVisible()

    // AC1.1 — and so did the occupancy rate.
    await expectOccupancy(page, { percent: 50, occupied: 1, vacant: 1 })

    // AC2.1 — a second overlapping lease on the same unit is refused.
    await page.goto('/leases/new')
    await page.getByLabel('Unit').selectOption({ index: 0 })
    await page.getByLabel('Start date').fill(daysFromToday(10))
    await page.getByRole('button', { name: 'Create lease' }).click()
    await expect(formAlert(page)).toContainText('Robin Vega already holds this unit')
    await expect(page).toHaveURL(/\/leases\/new/)

    // A term that starts after the current one has ended is fine, so the
    // refusal above is about the overlap and not about the unit being busy.
    await page.goto(leaseUrl)
    await page.getByRole('link', { name: 'Edit' }).click()
    await page.getByLabel('End date').fill(daysFromToday(30))
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page).toHaveURL(leaseUrl)

    await page.goto('/leases/new')
    await page.getByLabel('Unit').selectOption({ index: 0 })
    await page.getByLabel('Start date').fill(daysFromToday(31))
    await page.getByRole('button', { name: 'Create lease' }).click()
    await expect(page).toHaveURL(/\/leases\/[0-9a-f-]{36}$/)
    // The detail screen names the day it begins rather than a vague label.
    await expect(page.getByText(/^Starts /)).toBeVisible()

    // The upcoming lease has not started, so the unit is still occupied by the
    // current one and the occupancy rate has not moved.
    await expectOccupancy(page, { percent: 50, occupied: 1, vacant: 1 })

    // --- AC2.2, the other direction: ending a lease frees the unit --------
    await page.goto(leaseUrl)
    await page.getByRole('button', { name: 'End lease' }).click()
    await page.getByLabel('Last day of the lease').fill(today())
    await page.getByRole('button', { name: 'End lease' }).click()
    await expect(page.getByText('Ended', { exact: true })).toBeVisible()

    await page.getByRole('link', { name: 'Open unit' }).click()
    await expect(page.getByText('Vacant — no lease covers today.')).toBeVisible()
    await expectOccupancy(page, { percent: 0, occupied: 0, vacant: 2 })
  })

  test('destructive actions are refused while anything hangs off the record', async ({ page }) => {
    await signUpFreshLandlord(page)

    await page.goto('/properties/new')
    await page.getByLabel('Property name').fill('Birch Row')
    await page.getByRole('button', { name: 'Create property' }).click()
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/)
    const propertyUrl = page.url()

    // An empty property can be deleted.
    await page.goto(`${propertyUrl}/edit`)
    await expect(page.getByRole('button', { name: 'Delete property' })).toBeVisible()

    await page.goto(propertyUrl)
    await page.getByRole('link', { name: 'Add the first unit' }).click()
    await page.getByLabel('Unit code').fill('1')
    await page.getByLabel('Default rent').fill('800')
    await page.getByRole('button', { name: 'Create unit' }).click()
    await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}$/)
    const unitUrl = page.url()

    // With a unit inside it, deleting the property would cascade to leases,
    // invoices and payments — so the button is closed off, not merely warned about.
    await page.goto(`${propertyUrl}/edit`)
    await expect(page.getByText('still holds 1 unit')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete property' })).toHaveCount(0)

    // Same story one level down, once a lease exists on the unit.
    await page.goto('/tenants/new')
    await page.getByLabel('Full name').fill('Casey Lin')
    await page.getByRole('button', { name: 'Create resident' }).click()

    await page.goto('/leases/new')
    await page.getByLabel('Start date').fill(today())
    await page.getByRole('button', { name: 'Create lease' }).click()
    await expect(page).toHaveURL(/\/leases\/[0-9a-f-]{36}$/)

    await page.goto(`${unitUrl}/edit`)
    await expect(page.getByText('has 1 lease on record')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete unit' })).toHaveCount(0)

    // And a resident cannot be removed out from under their own lease.
    await page.goto('/tenants')
    await page.getByRole('link', { name: 'Casey Lin' }).click()
    await page.getByRole('link', { name: 'Edit' }).click()
    await expect(page.getByText('is named on 1 lease')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete resident' })).toHaveCount(0)
  })

  test('a portfolio can be dismantled in the order the guards allow', async ({ page }) => {
    test.slow()
    await signUpFreshLandlord(page)

    await page.goto('/properties/new')
    await page.getByLabel('Property name').fill('Elm Lot')
    await page.getByRole('button', { name: 'Create property' }).click()
    await expect(page).toHaveURL(/\/properties\/[0-9a-f-]{36}$/)
    const propertyUrl = page.url()

    await page.getByRole('link', { name: 'Add the first unit' }).click()
    await page.getByLabel('Unit code').fill('A')
    await page.getByLabel('Default rent').fill('750')
    await page.getByRole('button', { name: 'Create unit' }).click()
    await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}$/)
    const unitUrl = page.url()

    await page.goto('/tenants/new')
    await page.getByLabel('Full name').fill('Jesse Park')
    await page.getByRole('button', { name: 'Create resident' }).click()
    await expect(page).toHaveURL(/\/tenants\/[0-9a-f-]{36}$/)
    const tenantUrl = page.url()

    await page.goto('/leases/new')
    await page.getByLabel('Start date').fill(today())
    await page.getByRole('button', { name: 'Create lease' }).click()
    await expect(page).toHaveURL(/\/leases\/[0-9a-f-]{36}$/)
    const leaseUrl = page.url()

    // Nothing has been billed against this lease, so it can be removed
    // outright — the guard is about invoices, not about the lease existing.
    await page.goto(`${leaseUrl}/edit`)
    await page.getByRole('button', { name: 'Delete lease' }).click()
    await page.getByRole('button', { name: 'Yes, delete it' }).click()
    await expect(page).toHaveURL(/\/leases$/)

    // The unit went back to vacant on the way out (AC2.2 covers deletes too).
    await expectOccupancy(page, { percent: 0, occupied: 0, vacant: 1 })

    await page.goto(`${unitUrl}/edit`)
    await page.getByRole('button', { name: 'Delete unit' }).click()
    await page.getByRole('button', { name: 'Yes, delete it' }).click()
    await expect(page).toHaveURL(propertyUrl)

    await page.goto(`${tenantUrl}/edit`)
    await page.getByRole('button', { name: 'Delete resident' }).click()
    await page.getByRole('button', { name: 'Yes, delete them' }).click()
    await expect(page).toHaveURL(/\/tenants$/)

    await page.goto(`${propertyUrl}/edit`)
    await page.getByRole('button', { name: 'Delete property' }).click()
    await page.getByRole('button', { name: 'Yes, delete it' }).click()
    await expect(page).toHaveURL(/\/properties$/)
    await expect(page.getByText('Elm Lot')).toHaveCount(0)
  })

  test('a new landlord cannot see or reach a seeded landlord’s portfolio', async ({ page }) => {
    await signUpFreshLandlord(page)

    await page.goto('/properties')
    await expect(page.getByText(SEED.propertyNameA)).toHaveCount(0)

    await page.goto('/tenants')
    await expect(page.getByText(SEED.residentNameA)).toHaveCount(0)

    // Guessing the URL of another organization's record gets nothing back —
    // the row is invisible under RLS, so the page has nothing to render.
    const property = await page.goto(`/properties/${SEED.propertyIdA}`)
    expect(property?.status()).toBe(404)

    const unit = await page.goto(`/units/${SEED.unitIdA}`)
    expect(unit?.status()).toBe(404)
  })
})
