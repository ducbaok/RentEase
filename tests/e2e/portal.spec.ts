import { test, expect, type Page, type APIRequestContext } from '@playwright/test'

/**
 * Stream 2A — the resident portal and maintenance, driven the way a resident
 * and their landlord drive them.
 *
 * What only a browser can prove is here: a magic-link sign-in that links an
 * invited account to its tenant record, a bill that shows the SAME breakdown the
 * landlord sees, a guessed URL for a neighbour's invoice returning nothing, and
 * a repair going from reported to in-progress with the resident seeing the
 * change. The database-level isolation is proved far more aggressively in
 * supabase/tests/rls_tenant_isolation.test.sql and rls_portal_maintenance.test.sql.
 *
 * Fixture: supabase/seed.sql. Nina Alvarez (unit 103) is seeded WITHOUT a portal
 * account on purpose — she is the clean subject for the invite-and-claim flow.
 */

const MAILPIT = 'http://127.0.0.1:54324'

// A 1×1 transparent PNG — a real, uploadable image without shipping a fixture file.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

async function signInWithPassword(page: Page, email: string): Promise<void> {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'))
}

/**
 * Pulls the newest magic-link email for an address out of Mailpit and returns
 * the token_hash and type. The e2e verifies via token_hash rather than clicking
 * the emailed link, so it does not depend on the auth redirect allow-list or the
 * dev server's port.
 */
async function latestMagicLink(
  request: APIRequestContext,
  to: string,
): Promise<{ tokenHash: string; type: string }> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const list = await request.get(`${MAILPIT}/api/v1/messages?limit=50`)
    if (list.ok()) {
      const body = (await list.json()) as { messages?: Array<{ ID: string; To?: Array<{ Address: string }> }> }
      const message = (body.messages ?? []).find((m) =>
        (m.To ?? []).some((addr) => addr.Address.toLowerCase() === to.toLowerCase()),
      )
      if (message) {
        const full = await request.get(`${MAILPIT}/api/v1/message/${message.ID}`)
        const detail = (await full.json()) as { Text?: string; HTML?: string }
        const text = detail.Text ?? detail.HTML ?? ''
        const match = text.match(/https?:\/\/[^\s"'<>]*\/auth\/v1\/verify\?[^\s"'<>]+/)
        if (match) {
          const url = new URL(match[0].replace(/&amp;/g, '&'))
          const tokenHash = url.searchParams.get('token') ?? url.searchParams.get('token_hash')
          const type = url.searchParams.get('type') ?? 'magiclink'
          if (tokenHash) return { tokenHash, type }
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`No magic-link email arrived for ${to}. Is Mailpit running on ${MAILPIT}?`)
}

test.describe('magic-link onboarding', () => {
  test('AC7.2: an invited resident signs in by link and sees the landlord’s exact breakdown', async ({
    page,
    request,
  }) => {
    await page.goto('/magic-link')
    await page.getByLabel('Email').fill('nina@resident.test')
    await page.getByRole('button', { name: /Email me a sign-in link/ }).click()
    await expect(page.getByText(/Check your email/)).toBeVisible()

    const { tokenHash, type } = await latestMagicLink(request, 'nina@resident.test')
    await page.goto(`/magic-link/callback?token_hash=${tokenHash}&type=${type}`)

    // Landed in the portal as Nina, linked to her tenant record.
    await expect(page).toHaveURL(/\/portal/)
    await expect(page.getByRole('heading', { name: /Hello, Nina/ })).toBeVisible()

    // Her July 2026 bill for unit 103, opened to its working.
    await page.getByRole('row').filter({ hasText: 'July 2026' }).getByRole('link').click()
    await expect(page.getByRole('heading', { name: /Unit 103 · July 2026/ })).toBeVisible()

    // The SAME breakdown component the operator screen renders — proved by the
    // identical "prev → curr = usage unit × rate" wording and the total.
    const electric = page.getByRole('row').filter({ hasText: 'Electricity' })
    await expect(electric).toContainText('500 → 790 = 290 kWh × $0.14')
    await expect(page.getByRole('row').filter({ hasText: 'Water' })).toContainText(
      '1500 → 1660 = 160 gal × $0.012',
    )
    await expect(page.getByRole('row').filter({ hasText: 'Total' }).first()).toContainText(
      '$1,047.52',
    )
  })
})

test.describe('a resident cannot reach another unit’s data (AC7.1)', () => {
  // Ray rents unit 102, Sam rents unit A1 in another org. Dana rents unit 101.
  const RAY_INVOICE = 'a0000000-0000-4000-8000-000000000051'
  const SAM_INVOICE = 'b0000000-0000-4000-8000-000000000050'

  test('a guessed invoice URL for a neighbour returns 404, not their bill', async ({ page }) => {
    await signInWithPassword(page, 'dana@resident.test')
    await expect(page).toHaveURL(/\/portal/)

    const neighbour = await page.goto(`/portal/invoices/${RAY_INVOICE}`)
    expect(neighbour?.status()).toBe(404)

    const otherOrg = await page.goto(`/portal/invoices/${SAM_INVOICE}`)
    expect(otherOrg?.status()).toBe(404)
  })

  test('a resident is bounced off the operator dashboard', async ({ page }) => {
    await signInWithPassword(page, 'dana@resident.test')
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/portal/)
  })
})

test.describe('a repair goes from reported to in progress (F8, AC8.1)', () => {
  test('resident reports it with a photo, operator advances it, resident sees the change', async ({
    page,
  }) => {
    const title = `Leaking radiator ${Date.now()}`

    // --- Resident files it, with a photo ---
    await signInWithPassword(page, 'dana@resident.test')
    await page.goto('/portal/maintenance/new')

    await page.getByLabel(/what.?s wrong/i).fill(title)
    await page.getByLabel(/More detail/i).fill('Puddle under the radiator in the hall.')
    await page.getByLabel(/Photos/i).setInputFiles({
      name: 'radiator.png',
      mimeType: 'image/png',
      buffer: PNG_1PX,
    })
    await page.getByRole('button', { name: 'Send request' }).click()

    // Landed on the request, which shows the title, "Submitted", and the photo.
    await expect(page).toHaveURL(/\/portal\/maintenance\/[0-9a-f-]+$/)
    await expect(page.getByText(title)).toBeVisible()
    await expect(page.getByText('Submitted')).toBeVisible()
    await expect(page.getByRole('img', { name: 'Reported problem' })).toBeVisible()

    const requestUrl = page.url()

    // --- Operator advances it ---
    await signInWithPassword(page, 'alice@northside.test')
    await page.goto('/maintenance')
    await page.getByRole('row').filter({ hasText: title }).getByRole('link').click()
    await expect(page.getByText(title)).toBeVisible()

    await page.getByRole('button', { name: 'Mark as in progress' }).click()
    await expect(page.getByText(/Status updated/)).toBeVisible()

    // --- Resident sees the new status ---
    await signInWithPassword(page, 'dana@resident.test')
    await page.goto(requestUrl)
    await expect(page.getByText(title)).toBeVisible()
    await expect(page.getByText('In progress')).toBeVisible()
  })
})
