import { test, expect, type Page } from '@playwright/test'

/**
 * F9 — reading a meter off a photograph, in the only place it is a feature.
 *
 * The unit tests already prove what a suggestion is allowed to be, and prove
 * that the photo action writes nothing. Neither of them can prove the thing
 * this feature actually promises, because it only exists once a browser, a
 * server action and a form are all in the same room:
 *
 *   a. a number read off a photo lands in the box, and a PERSON still has to
 *      press Save before there is a row in the database (AC9.1, AC9.2, AC9.6)
 *   b. a provider having a bad day changes nothing about typing them in
 *      (AC9.3, AC9.4, AC9.5)
 *
 * Both halves are needed. With only (a) the feature could be quietly saving on
 * everyone's behalf; with only (b) it could be broken and nobody would know.
 *
 * The model is stood in for by lib/ai/testing/scripted-provider.ts, installed
 * by instrumentation.ts because playwright.config.ts starts the dev server with
 * AI_FAKE_PROVIDER=1. Its answer is written inside the upload, so no state is
 * arranged anywhere and nothing is remembered between requests: these tests
 * pass in any order, alone or in a suite, and a run costs nothing.
 *
 * Fixture: supabase/seed.sql (Northside, units 101–103). The month is drawn
 * fresh each run from decades nobody bills, so a previous run's saved readings
 * cannot make "nothing was saved" quietly true.
 */

const SEED = {
  owner: { email: 'alice@northside.test', password: 'password123' },
}

/** An empty month, chosen in beforeAll. */
let PERIOD = ''

const UNITS = ['101', '102', '103'] as const

async function signIn(page: Page) {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(SEED.owner.email)
  await page.getByLabel('Password').fill(SEED.owner.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'))
}

/**
 * A "photograph" whose bytes tell the scripted provider what to answer.
 *
 * The bytes are a REAL PNG, and that is the load-bearing part. This upload used
 * to be the marker line by itself, on the reasoning that nothing in the path
 * decodes it. That reasoning was right about the server and wrong about the
 * browser, and it quietly disarmed the one assertion in this file about SEEING
 * the photograph: `toBeVisible()` is true of an <img> that has a box and an
 * accessible name whether or not it ever drew a pixel.
 *
 * The directive is appended AFTER the PNG's IEND chunk. A decoder stops there,
 * so the browser renders the picture and ignores the rest, while the provider —
 * which scans the raw bytes for its marker — still finds its script. One upload
 * is therefore both a real image and a real instruction.
 */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  'base64',
)

function scriptedPhoto(script: string) {
  return {
    name: 'meter.png',
    mimeType: 'image/png',
    buffer: Buffer.concat([ONE_PIXEL_PNG, Buffer.from(`\nRENTEASE-FAKE ${script}\n`)]),
  }
}

function readingBoxes(page: Page, unit: string) {
  return {
    camera: page.getByLabel(`Photo of the meters for unit ${unit}`),
    electric: page.getByLabel(`Electric reading for unit ${unit}`),
    water: page.getByLabel(`Water reading for unit ${unit}`),
    thumbnail: page.getByAltText(`The meter photo just taken for unit ${unit}`),
  }
}

const saveButton = (page: Page) => page.getByRole('button', { name: /^Save \d+ reading/ })

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage()
  await signIn(page)

  /*
   * Any month with no readings in it will do, and an earlier run of this file
   * leaves two behind — so candidates are drawn at random from four decades and
   * checked against the app, the same way billing.spec picks an unbilled
   * period. Without this the "a reload throws the numbers away" assertion would
   * pass on the first run and lie on the second.
   */
  for (let attempt = 0; attempt < 25 && PERIOD === ''; attempt++) {
    const year = 2050 + Math.floor(Math.random() * 40)
    const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')
    const candidate = `${year}-${month}`

    await page.goto(`/meters?period=${candidate}`)
    await expect(readingBoxes(page, '101').electric).toBeVisible()

    const values = await Promise.all(
      UNITS.flatMap((unit) => {
        const boxes = readingBoxes(page, unit)
        return [boxes.electric.inputValue(), boxes.water.inputValue()]
      }),
    )
    if (values.every((value) => value === '')) PERIOD = candidate
  }

  expect(PERIOD, 'found no month without readings in 25 tries').not.toBe('')
  await page.close()
})

test('AC9.1/9.2/9.6: a photo fills the boxes, and only a person saves them', async ({ page }) => {
  await signIn(page)
  await page.goto(`/meters?period=${PERIOD}`)

  const { camera, electric, water, thumbnail } = readingBoxes(page, '101')

  await expect(
    camera,
    'no camera button. The dev server must be the one Playwright starts — it passes ' +
      'AI_FAKE_PROVIDER=1 (playwright.config.ts). A `pnpm dev` you started yourself has no ' +
      'provider, so the button is deliberately not rendered.',
  ).toBeAttached()

  // Well above anything the seed or the other specs write, so the reading is
  // never a decrease and never needs confirming, whatever ran before this.
  const photo = scriptedPhoto('electric=9200 water=9400 confidence=high')
  await camera.setInputFiles(photo)

  // AC9.1 — the numbers are in the boxes.
  await expect(electric).toHaveValue('9200')
  await expect(water).toHaveValue('9400')

  // AC9.2 — and the picture they came from is on screen next to them, so the
  // person about to accept them can see what they are accepting.
  await expect(thumbnail).toBeVisible()

  /*
   * On screen is not the same as SHOWN, and AC9.2 is about the second one. An
   * <img> whose object URL was handed back too early still has a box, still has
   * its alt text, and still passes toBeVisible() — while the person looks at a
   * broken picture and confirms a number against nothing.
   *
   * That is not hypothetical: the revoke bookkeeping in reading-grid.tsx
   * (photosRef, isSettled, two effects) is exactly the machinery that would
   * produce it, and before this assertion existed, revoking the URL one line
   * after creating it left all three tests in this file green.
   *
   * Polled rather than read once: decoding is asynchronous, and a number
   * arriving late is not the failure being hunted.
   */
  await expect
    .poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0)

  /*
   * AC9.6 — and that is everything that happened. The drafts live in the
   * browser, so a reload throws them away; if the photo had written a row,
   * these boxes would come back holding it.
   */
  await page.reload()
  await expect(electric).toHaveValue('')
  await expect(water).toHaveValue('')

  // Now with a person: the same photo, then the button they already use.
  await camera.setInputFiles(photo)
  await expect(electric).toHaveValue('9200')
  await saveButton(page).click()
  await expect(page.getByText(/^Readings /)).toBeVisible()

  // Saved, so the photo has done its job and is gone (AC9.2 is "until saved").
  await expect(thumbnail).toHaveCount(0)

  await page.reload()
  await expect(electric).toHaveValue('9200')
  await expect(water).toHaveValue('9400')
})

test('AC9.3: a dial nobody could read leaves an empty box, not a guess', async ({ page }) => {
  await signIn(page)
  await page.goto(`/meters?period=${PERIOD}`)

  const { camera, electric, water } = readingBoxes(page, '103')

  await camera.setInputFiles(scriptedPhoto('electric=9500 water=null confidence=low'))

  await expect(electric).toHaveValue('9500')
  await expect(water).toHaveValue('')
  await expect(page.getByText('The water dial could not be read')).toBeVisible()

  // Half a row is not a reading: the form does not submit one, and nothing was
  // invented to complete it.
  await page.reload()
  await expect(electric).toHaveValue('')
  await expect(water).toHaveValue('')
})

test('AC9.4/9.5: when the reading service fails, the keyboard still works', async ({ page }) => {
  await signIn(page)
  await page.goto(`/meters?period=${PERIOD}`)

  const { camera, electric, water } = readingBoxes(page, '102')

  await camera.setInputFiles(scriptedPhoto('fail=network'))

  // One sentence about what to do instead — not a stack trace, and above all
  // not a number.
  await expect(
    page.getByText('Could not reach the reading service just now. Type the numbers in as usual.'),
  ).toBeVisible()
  await expect(electric).toHaveValue('')
  await expect(water).toHaveValue('')

  // And the screen the failure happened on is the same screen as before F9.
  await electric.fill('9100')
  await water.fill('9300')
  await saveButton(page).click()
  await expect(page.getByText(/^Readings /)).toBeVisible()

  await page.reload()
  await expect(electric).toHaveValue('9100')
  await expect(water).toHaveValue('9300')
})
