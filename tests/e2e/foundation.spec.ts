import { test, expect } from '@playwright/test'

/**
 * Milestone M0 — the foundation, proved end to end.
 *
 * These tests exercise the three things every later batch depends on: an
 * account can be created and lands inside its own organization, the three
 * identities are routed to their own side of the app, and none of it is
 * reachable without signing in.
 *
 * Row-level isolation itself is proved in supabase/tests/*.test.sql, where it
 * can be attacked directly at the database rather than through the UI. What is
 * tested here is that the application actually runs under those rules.
 *
 * Fixture: supabase/seed.sql. Run `pnpm db:reset` before this suite.
 */

const SEED = {
  ownerA: { email: 'alice@northside.test', password: 'password123', org: 'Northside Rentals' },
  managerA: { email: 'mike@northside.test', password: 'password123', org: 'Northside Rentals' },
  ownerB: { email: 'bob@lakeview.test', password: 'password123', org: 'Lakeview Property Group' },
  residentA: { email: 'dana@resident.test', password: 'password123', name: 'Dana Whitfield' },
}

/**
 * The org name and role appear both in the header chrome and in the page body,
 * so assertions scope to the header. Matching loosely would pass on the welcome
 * sentence and stop proving that the header identifies the right organization.
 */
function header(page: import('@playwright/test').Page) {
  return page.locator('header')
}

async function signIn(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe('access', () => {
  test('the dashboard is unreachable without signing in', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('the resident portal is unreachable without signing in', async ({ page }) => {
    await page.goto('/portal')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('a wrong password says nothing about whether the account exists', async ({ page }) => {
    await signIn(page, SEED.ownerA.email, 'not-the-password')
    await expect(page.getByRole('alert')).toContainText('did not match an account')
    await expect(page).toHaveURL(/\/sign-in/)
  })
})

test.describe('signing in lands each identity on its own side of the app', () => {
  test('an owner lands in their own organization', async ({ page }) => {
    await signIn(page, SEED.ownerA.email, SEED.ownerA.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(header(page).getByText(SEED.ownerA.org)).toBeVisible()
    await expect(page.getByText(SEED.ownerB.org)).toHaveCount(0)
  })

  test('a manager lands in the same organization, marked as manager', async ({ page }) => {
    await signIn(page, SEED.managerA.email, SEED.managerA.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(header(page).getByText(SEED.managerA.org)).toBeVisible()
    await expect(header(page).getByText('manager')).toBeVisible()
  })

  test('a second landlord sees only their own organization', async ({ page }) => {
    await signIn(page, SEED.ownerB.email, SEED.ownerB.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(header(page).getByText(SEED.ownerB.org)).toBeVisible()
    await expect(page.getByText(SEED.ownerA.org)).toHaveCount(0)
  })

  test('a resident lands in the portal, not the dashboard', async ({ page }) => {
    await signIn(page, SEED.residentA.email, SEED.residentA.password)
    await expect(page).toHaveURL(/\/portal/)
    await expect(header(page).getByText(SEED.residentA.name)).toBeVisible()
  })

  test('a resident who asks for the dashboard is sent back to the portal', async ({ page }) => {
    await signIn(page, SEED.residentA.email, SEED.residentA.password)
    await expect(page).toHaveURL(/\/portal/)
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/portal/)
  })

  test('an operator who asks for the portal is sent back to the dashboard', async ({ page }) => {
    await signIn(page, SEED.ownerA.email, SEED.ownerA.password)
    await page.goto('/portal')
    await expect(page).toHaveURL(/\/dashboard/)
  })
})

test.describe('signing up', () => {
  test('a new landlord gets an account, an organization, and an empty dashboard', async ({
    page,
  }) => {
    // Unique per run so the suite can be re-run without resetting the database.
    const email = `founder-${Date.now()}@example.test`
    const orgName = `Test Rentals ${Date.now()}`

    await page.goto('/sign-up')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('password123')
    await page.getByRole('button', { name: 'Create account' }).click()

    // A brand-new account owns nothing yet, so it has no identity under RLS.
    // That gap is real and must land here rather than on a broken dashboard.
    await expect(page).toHaveURL(/\/sign-up\/organization/)

    await page.getByLabel('Business name').fill(orgName)
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page).toHaveURL(/\/dashboard/)
    await expect(header(page).getByText(orgName)).toBeVisible()
    await expect(header(page).getByText('owner')).toBeVisible()

    // The new organization is empty — and none of the seeded data leaks into it.
    await expect(page.getByText(SEED.ownerA.org)).toHaveCount(0)
    await page.goto('/properties')
    await expect(page.getByText('Cedar Court')).toHaveCount(0)
  })

  test('signing out ends the session', async ({ page }) => {
    await signIn(page, SEED.ownerA.email, SEED.ownerA.password)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/sign-in/)
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/sign-in/)
  })
})
