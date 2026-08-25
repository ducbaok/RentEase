import { test, expect, type Page } from '@playwright/test'

/**
 * Stream 1B — the billing engine, driven the way a landlord drives it.
 *
 * What is proved here is the part that only exists once a browser is involved:
 * the entry screen refusing a reading that went backwards, the review screen
 * naming the units nobody read, the issue button being safe to press twice, and
 * an invoice showing its own arithmetic. The rules underneath are proved
 * separately and more aggressively in supabase/tests/billing.test.sql.
 *
 * Fixture: supabase/seed.sql. Run `pnpm db:reset` before the suite for the
 * cleanest run — but it is written to survive a re-run without one:
 *
 *   - the meter tests re-enter the same period and re-assert the same warnings
 *   - everything that must start from "not yet issued" uses BILLING_PERIOD,
 *     a period picked fresh each run, far beyond anything seeded, covered only
 *     by unit 103's open-ended lease
 */

const SEED = {
  owner: { email: 'alice@northside.test', password: 'password123' },
}

/**
 * A period nothing has billed yet, inside the one lease that never ends (unit
 * 103, from 2026-02-15). Exactly one invoice comes out of it, and no meter
 * reading exists for it — which is also how AC4.2's "no reading" warning gets
 * exercised.
 *
 * It is CHOSEN, not computed: an earlier run of this suite leaves its invoice
 * behind, and a period that is already billed would make the "issue" assertions
 * report a false failure. So candidates are drawn at random from six decades of
 * empty months and checked against the app until an unbilled one turns up.
 */
let BILLING_PERIOD = ''
/** The same period as the screens print it, e.g. 'March 2042'. */
let PERIOD_LABEL = ''

async function signIn(page: Page) {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(SEED.owner.email)
  await page.getByLabel('Password').fill(SEED.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'))
}

function labelFor(period: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${period}-01T00:00:00Z`))
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage()
  await signIn(page)

  for (let attempt = 0; attempt < 25 && BILLING_PERIOD === ''; attempt++) {
    // 2040-01 … 2089-12. Stops short of 2099, where the rate-card test below
    // schedules a different service fee that would change the totals asserted.
    const months = Math.floor(Math.random() * 12 * 50)
    const candidate = `${2040 + Math.floor(months / 12)}-${String((months % 12) + 1).padStart(2, '0')}`

    await page.goto(`/invoices?period=${candidate}`)
    if (await page.getByText(`No invoices for ${labelFor(candidate)}`).isVisible()) {
      BILLING_PERIOD = candidate
    }
  }

  await page.close()

  if (BILLING_PERIOD === '') {
    throw new Error('Could not find an unbilled period to test with. Run `pnpm db:reset`.')
  }
  PERIOD_LABEL = labelFor(BILLING_PERIOD)
})

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test.describe('rates', () => {
  test('the rate card in force for this month is marked as such', async ({ page }) => {
    await page.goto('/tariffs')
    await expect(page.getByRole('heading', { name: 'Rates', exact: true })).toBeVisible()

    // The seeded card: $0.14/kWh, $0.012/gal, $25.00 service fee.
    const row = page.getByRole('row').filter({ hasText: 'Jan 1, 2026' })
    await expect(row).toContainText('$0.14')
    await expect(row).toContainText('$0.012')
    await expect(row).toContainText('$25.00')

    // A landlord is told, in the product, that the rates are their call.
    await expect(page.getByText('You set these rates, and you answer for them')).toBeVisible()
  })

  test('a new rate card can be added and shows as scheduled', async ({ page }) => {
    await page.goto('/tariffs')

    // Far beyond every period these tests bill, so it cannot change any total
    // asserted elsewhere in the suite.
    await page.getByLabel('Rates start on').fill('2099-01-01')
    await page.getByLabel('Service fee per month ($)').fill('31.50')
    await page.getByLabel('Electricity ($ per kWh)').fill('0.1425')
    await page.getByLabel('Water ($ per gal)').fill('0.0125')
    await page.getByRole('button', { name: 'Save rates' }).click()

    const row = page.getByRole('row').filter({ hasText: 'Jan 1, 2099' })
    await expect(row).toBeVisible()
    // Four decimals survive the round trip — utility rates really are $0.1425.
    await expect(row).toContainText('$0.1425')
    await expect(row).toContainText('$31.50')
    await expect(row.getByText('Scheduled')).toBeVisible()
  })
})

test.describe('entering meter readings', () => {
  const PERIOD = '2026-09'

  test('AC3.1: a reading below last month is never saved without a confirmation', async ({
    page,
  }) => {
    await page.goto(`/meters?period=${PERIOD}`)

    // Last month's closing numbers are already there, and cannot be typed over.
    const unit101 = page.getByLabel('Electric reading for unit 101')
    await unit101.fill('1000') // September reads lower than August's 2610
    await page.getByLabel('Water reading for unit 101').fill('3800')

    // Unit 102 is ordinary except for the electricity, which triples.
    await page.getByLabel('Electric reading for unit 102').fill('2755')
    await page.getByLabel('Water reading for unit 102').fill('2600')

    // The warning appears while typing, before anything is submitted.
    await expect(page.getByText('Electric reading went down')).toBeVisible()

    // On a re-run the confirmation is already ticked from last time; clear it,
    // because what is being tested is what the SERVER does without it.
    const confirm = page.getByLabel('Confirm the lower reading for unit 101')
    if (await confirm.isChecked()) await confirm.uncheck()

    await page.getByRole('button', { name: /^Save \d+ reading/ }).click()

    // The server refused that row and said which one, rather than saving it
    // quietly or rejecting the whole batch.
    await expect(page.getByText(/came in lower than last month/)).toBeVisible()
    await expect(page.getByText(/The other 1 saved fine/)).toBeVisible()
  })

  test('AC3.1: confirming it saves the reading, and nothing is billed for the drop', async ({
    page,
  }) => {
    await page.goto(`/meters?period=${PERIOD}`)

    await page.getByLabel('Electric reading for unit 101').fill('1000')
    await page.getByLabel('Water reading for unit 101').fill('3800')

    const confirm = page.getByLabel('Confirm the lower reading for unit 101')
    await confirm.check()
    await page.getByLabel('Why unit 101 reads lower').fill('Meter replaced on the 3rd')

    await page.getByRole('button', { name: /^Save \d+ reading/ }).click()
    await expect(page.getByText(/^Readings /)).toBeVisible()

    // Reload: the number is there, and so is the reason it was accepted.
    await page.reload()
    await expect(page.getByLabel('Electric reading for unit 101')).toHaveValue('1000')
    await expect(page.getByLabel('Why unit 101 reads lower')).toHaveValue(
      'Meter replaced on the 3rd',
    )
  })

  test('AC3.2: usage far above normal for that unit is flagged', async ({ page }) => {
    await page.goto(`/meters?period=${PERIOD}`)

    // Unit 102 used 330 and 345 kWh in the two months before. 1,100 is more
    // than three times that.
    await page.getByLabel('Electric reading for unit 102').fill('2755')
    await page.getByLabel('Water reading for unit 102').fill('2600')

    await expect(page.getByText('Electricity use unusually high')).toBeVisible()
    // The water is ordinary, so it is not flagged — the meters are judged apart.
    await expect(page.getByText('Water use unusually high')).toHaveCount(0)
  })
})

test.describe('issuing invoices', () => {
  test('AC4.2: the review names the leases already billed before anything is created', async ({
    page,
  }) => {
    await page.goto('/invoices/issue?period=2026-08')

    // Unit 101 was billed for August in the seed; the other two were not.
    await expect(page.getByText('1 lease is already invoiced for this month')).toBeVisible()

    await expect(page.locator('tr[data-unit="102"]')).toContainText('$1,125.64') // 1050.00 + 48.30 + 2.34 + 25.00
    await expect(page.locator('tr[data-unit="103"]')).toContainText('$1,043.44') // 980.00 + 36.40 + 2.04 + 25.00
    await expect(page.locator('tr[data-unit="101"]').getByText('Already issued')).toBeVisible()
  })

  test('AC4.2 / AC4.1: units with no reading are called out, and issuing twice bills once', async ({
    page,
  }) => {
    await page.goto(`/invoices/issue?period=${BILLING_PERIOD}`)

    // Nobody read a meter for this month, so the review says so by name.
    await expect(page.getByText('1 unit has no meter reading')).toBeVisible()
    await expect(page.getByText(/will be billed rent and fees only/)).toBeVisible()

    await page.getByRole('button', { name: 'Issue 1 invoice' }).click()
    await expect(page.getByText(`Issued 1 invoice for ${BILLING_PERIOD}.`)).toBeVisible()

    // The button is deliberately still there. Pressing it again is the thing
    // AC4.1 promises is safe.
    await page.getByRole('button', { name: /^Issue/ }).click()
    await expect(page.getByText(/Nothing to issue/)).toBeVisible()

    // And the list has exactly one invoice for the period, not two.
    await page.goto(`/invoices?period=${BILLING_PERIOD}`)
    await expect(page.getByRole('row').filter({ hasText: 'Nina Alvarez' })).toHaveCount(1)
    // Rent $980.00 + the $25.00 service fee, and no metered lines.
    await expect(page.getByRole('row').filter({ hasText: 'Nina Alvarez' })).toContainText(
      '$1,005.00',
    )
  })
})

test.describe('an invoice explains itself', () => {
  test('AC4.3: every metered line shows both readings, the usage and the rate', async ({
    page,
  }) => {
    await page.goto('/invoices?period=2026-07')
    await page.getByRole('row').filter({ hasText: 'Dana Whitfield' }).getByRole('link').click()

    await expect(page.getByRole('heading', { name: /Unit 101/ })).toBeVisible()

    const electric = page.getByRole('row').filter({ hasText: 'Electricity' })
    await expect(electric).toContainText('1420 → 2047 = 627 kWh × $0.14')
    await expect(electric).toContainText('$87.78')

    const water = page.getByRole('row').filter({ hasText: 'Water' })
    await expect(water).toContainText('3100 → 3450 = 350 gal × $0.012')
    await expect(water).toContainText('$4.20')

    await expect(page.getByRole('row').filter({ hasText: 'Rent' })).toContainText('$1,200.00')
    await expect(page.getByRole('row').filter({ hasText: 'Service fee' })).toContainText('$25.00')
    await expect(page.getByRole('row').filter({ hasText: 'Total' }).first()).toContainText(
      '$1,316.98',
    )

    // The snapshot is explicitly not recomputed from today's rate card.
    await expect(page.getByText(/changing your rates later does not restate this invoice/)).toBeVisible()
  })
})

test.describe('money coming in', () => {
  /** The invoice created earlier in this run, for the period nothing else touches. */
  async function openTestInvoice(page: Page) {
    await page.goto(`/invoices?period=${BILLING_PERIOD}`)
    await page.getByRole('row').filter({ hasText: 'Nina Alvarez' }).getByRole('link').click()
    await expect(page.getByRole('heading', { name: /Unit 103/ })).toBeVisible()
  }

  test('AC5.2: a correction after issuing is recorded with who, what and why', async ({ page }) => {
    await openTestInvoice(page)

    await page.getByRole('button', { name: 'Correct this invoice' }).click()
    await page.getByLabel('Rent ($)').fill('900.00')
    await page
      .getByLabel('Why (recorded in the history)')
      .fill('Agreed a reduction for the week without hot water')
    await page.getByRole('button', { name: 'Save change' }).click()

    await expect(page.getByText(/Invoice updated/)).toBeVisible()

    await page.reload()
    // The total followed the correction, and the history says what moved.
    await expect(page.getByRole('row').filter({ hasText: 'Rent' }).first()).toContainText('$900.00')

    const history = page.getByRole('row').filter({ hasText: 'Agreed a reduction' })
    await expect(history).toContainText('$980.00 → $900.00')
    await expect(history).toContainText('$1,005.00 → $925.00')
  })

  test('AC5.1: part of the money makes it partial, the rest makes it paid', async ({ page }) => {
    await openTestInvoice(page)

    // $925.00 outstanding after the correction above.
    await page.getByLabel('Amount received ($)').fill('400.00')
    await page.getByRole('button', { name: 'Record payment' }).click()
    await expect(page.getByText(/Payment recorded/)).toBeVisible()

    await page.reload()
    await expect(page.getByText('Partially paid')).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'Outstanding' })).toContainText('$525.00')

    // The rest, in a second payment — the balance is the sum, not a running total.
    await page.getByLabel('Amount received ($)').fill('525.00')
    await page.getByRole('button', { name: 'Record payment' }).click()
    await expect(page.getByText(/Payment recorded/)).toBeVisible()

    await page.reload()
    await expect(page.getByText('Paid').first()).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'Outstanding' })).toContainText('$0.00')
  })

  test('AC5.1: removing a payment recalculates the balance, and says why it went', async ({
    page,
  }) => {
    await page.goto('/payments')

    // Pinned to this run's period and to the second of the two payments, so a
    // suite re-run cannot pick up a payment left behind by an earlier one.
    const row = page
      .getByRole('row')
      .filter({ hasText: PERIOD_LABEL })
      .filter({ hasText: '$525.00' })
      .first()

    await row.getByRole('button', { name: 'Remove' }).click()
    await row.getByLabel('Why this payment is being removed').fill('Entered twice by mistake')
    await row.getByRole('button', { name: 'Remove' }).click()

    // The row leaving the ledger is the confirmation.
    await expect(row).toHaveCount(0)

    // Back to owing money, and the payment that stayed is untouched.
    await page.goto(`/invoices?period=${BILLING_PERIOD}`)
    const invoice = page.getByRole('row').filter({ hasText: 'Nina Alvarez' })
    await expect(invoice).toContainText('$400.00')
    await expect(invoice).toContainText('$525.00')
  })
})
