import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * lib/env.ts validates the Supabase variables at module load, and this action's
 * module reaches it through @/lib/auth. Neither Supabase nor these values are
 * under test; vi.hoisted runs before the imports below, which is the only
 * reason it sits above them. Same reason as tests/unit/ai/provider.test.ts.
 */
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon-key-not-used-by-these-tests'
})

/**
 * The write path, mocked so that a call to it is a test failure rather than a
 * database error. This is the assertion the whole file exists for: AC9.6 says
 * the ONLY way a number reaches meter_readings is a person submitting the form.
 * A photo action that quietly saved what it read would look helpful, pass every
 * feature test, and remove the human from the one step that catches a wrong
 * number.
 */
const meters = vi.hoisted(() => ({
  saveReadings: vi.fn(),
  getMeterSheet: vi.fn(),
  listReadingAudit: vi.fn(),
}))
vi.mock('@/lib/data/meters', () => meters)

const auth = vi.hoisted(() => ({
  requireOperator: vi.fn(async () => ({
    kind: 'operator' as const,
    userId: 'user-1',
    email: 'landlord@example.com',
    fullName: 'A Landlord',
    orgId: 'org-1',
    orgName: 'Example Lettings',
    role: 'owner' as const,
  })),
}))
vi.mock('@/lib/auth', () => auth)

/* revalidatePath needs a request context. It is mocked so that CALLING it is
 * observable — the read-only action must not, and a cache bust would be the
 * quietest possible sign that this action had grown a write. */
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }))
vi.mock('next/cache', () => cache)

import { readMeterPhotoAction } from '@/app/(dashboard)/meters/actions'
import { setAiProvider } from '@/lib/ai/provider'
import { AI_CALL_WINDOWS, resetAiRateLimit } from '@/lib/ai/rate-limit'
import { MAX_PHOTO_BYTES } from '@/lib/ai/tasks/meter-ocr'
import type { AiProvider, AiResult } from '@/lib/ai/types'

const ACTIONS_SOURCE = 'app/(dashboard)/meters/actions.ts'

function photo(bytes: number, type = 'image/jpeg'): File {
  return new File([new Uint8Array(bytes)], 'meter.jpg', { type })
}

function provider(result: AiResult<unknown>): AiProvider {
  return { name: 'fake', run: vi.fn(async () => result) as AiProvider['run'] }
}

function form(file: File | null): FormData {
  const data = new FormData()
  if (file) data.set('photo', file)
  return data
}

const GOOD = { electric: 14320.5, water: 812, confidence: 'high' as const }

describe('readMeterPhotoAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setAiProvider(provider({ ok: true, value: GOOD }))
    // The action counts calls per operator now, and every test in this file is
    // the same operator. Without this the file would start failing partway down
    // for a reason having nothing to do with the test that failed.
    resetAiRateLimit()
  })

  afterEach(() => {
    setAiProvider(null)
    resetAiRateLimit()
  })

  // -------------------------------------------------------------------------
  // It does not write. Everything else in this file is secondary.
  // -------------------------------------------------------------------------

  it('never calls the write path, even on the happy path (AC9.6)', async () => {
    const state = await readMeterPhotoAction({}, form(photo(64)))

    expect(state.suggestion).toEqual(GOOD)
    expect(meters.saveReadings).not.toHaveBeenCalled()
  })

  it('reads nothing from the database either — it only looks at the photo', async () => {
    await readMeterPhotoAction({}, form(photo(64)))

    expect(meters.getMeterSheet).not.toHaveBeenCalled()
    expect(meters.listReadingAudit).not.toHaveBeenCalled()
  })

  it('does not bust the cache, because nothing changed', async () => {
    await readMeterPhotoAction({}, form(photo(64)))

    expect(cache.revalidatePath).not.toHaveBeenCalled()
  })

  it.each([
    ['a good answer', { ok: true, value: GOOD } as AiResult<unknown>],
    ['no provider', { ok: false, reason: 'no_provider' } as AiResult<unknown>],
    ['an answer that did not fit', { ok: false, reason: 'invalid_output' } as AiResult<unknown>],
    ['a network failure', { ok: false, reason: 'network' } as AiResult<unknown>],
  ])('writes nothing when the provider gives %s', async (_label, result) => {
    setAiProvider(provider(result))

    await readMeterPhotoAction({}, form(photo(64)))

    expect(meters.saveReadings).not.toHaveBeenCalled()
  })

  /*
   * A structural check to go with the behavioural ones. saveReadingsAction in
   * the same file legitimately imports saveReadings, so the assertion is scoped
   * to this function's own body: it must not name the write path at all.
   */
  it('does not so much as mention the write path in its body', () => {
    const source = readFileSync(ACTIONS_SOURCE, 'utf8')
    const start = source.indexOf('export async function readMeterPhotoAction')
    expect(start).toBeGreaterThan(-1)

    const body = source.slice(start)
    for (const forbidden of ['saveReadings', 'revalidatePath', 'upsert', '.insert(']) {
      expect(body).not.toContain(forbidden)
    }
  })

  // -------------------------------------------------------------------------
  // It costs money, so it checks who is asking before it spends any.
  // -------------------------------------------------------------------------

  it('resolves the operator on the server before spending anything', async () => {
    const ai = provider({ ok: true, value: GOOD })
    setAiProvider(ai)

    await readMeterPhotoAction({}, form(photo(64)))

    expect(auth.requireOperator).toHaveBeenCalled()
    expect(ai.run).toHaveBeenCalled()
  })

  it('lets the redirect out when the caller is not an operator', async () => {
    // requireOperator() signals "not signed in" by throwing Next's redirect.
    // Swallowing it would leave a stranger on the meter screen with a shrug.
    const redirect = new Error('NEXT_REDIRECT')
    auth.requireOperator.mockRejectedValueOnce(redirect)

    await expect(readMeterPhotoAction({}, form(photo(64)))).rejects.toBe(redirect)
  })

  it.each([
    ['a video renamed to .jpg', photo(64, 'video/mp4')],
    ['a PDF', photo(64, 'application/pdf')],
    ['an SVG, which is a document that can carry script', photo(64, 'image/svg+xml')],
    ['a file with no type at all', photo(64, '')],
  ])('refuses %s without calling the provider', async (_label, file) => {
    const ai = provider({ ok: true, value: GOOD })
    setAiProvider(ai)

    const state = await readMeterPhotoAction({}, form(file))

    expect(state.suggestion).toBeUndefined()
    expect(state.unavailable).toContain('not a photo')
    expect(ai.run).not.toHaveBeenCalled()
  })

  it('refuses a photo over the size cap without calling the provider', async () => {
    const ai = provider({ ok: true, value: GOOD })
    setAiProvider(ai)

    const state = await readMeterPhotoAction({}, form(photo(MAX_PHOTO_BYTES + 1)))

    expect(state.suggestion).toBeUndefined()
    expect(state.unavailable).toMatch(/over \d+ MB/)
    expect(ai.run).not.toHaveBeenCalled()
  })

  it.each([
    ['nothing attached', null],
    ['an empty file', photo(0)],
  ])('refuses %s without calling the provider', async (_label, file) => {
    const ai = provider({ ok: true, value: GOOD })
    setAiProvider(ai)

    const state = await readMeterPhotoAction({}, form(file))

    expect(state.unavailable).toBeTruthy()
    expect(ai.run).not.toHaveBeenCalled()
  })

  it('takes no organization from the request — the form cannot name one', async () => {
    const data = form(photo(64))
    data.set('org_id', 'someone-elses-org')

    const state = await readMeterPhotoAction({}, data)

    expect(state.suggestion).toEqual(GOOD)
    expect(auth.requireOperator).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // It never throws (AC9.5).
  // -------------------------------------------------------------------------

  it.each([
    ['no_provider', 'switched off'],
    ['network', 'Could not reach'],
    ['invalid_output', 'Could not make out'],
    ['refused', 'Could not read'],
  ])('turns %s into a sentence, not an exception', async (reason, expected) => {
    setAiProvider(provider({ ok: false, reason: reason as never }))

    const state = await readMeterPhotoAction({}, form(photo(64)))

    expect(state.suggestion).toBeUndefined()
    expect(state.unavailable).toContain(expected)
  })

  it('survives a provider that breaks its own contract and throws', async () => {
    setAiProvider({
      name: 'broken',
      run: vi.fn(async () => {
        throw new Error('sk-ant-live-key-should-never-reach-the-screen')
      }) as AiProvider['run'],
    })

    const state = await readMeterPhotoAction({}, form(photo(64)))

    expect(state.suggestion).toBeUndefined()
    expect(state.unavailable).toBeTruthy()
    // Whatever went wrong is ours, not the landlord's, and not the screen's.
    expect(state.unavailable).not.toContain('sk-ant')
  })

  it('offers nothing at all when the answer was broken — not a partial reading', async () => {
    setAiProvider(
      provider({ ok: true, value: { electric: 999999, water: 0, confidence: 'high', note: 'x' } }),
    )

    const state = await readMeterPhotoAction({}, form(photo(64)))

    expect(state.suggestion).toBeUndefined()
    expect(JSON.stringify(state)).not.toContain('999999')
  })

  // -------------------------------------------------------------------------
  // And there is a ceiling on how much one caller can spend.
  // -------------------------------------------------------------------------

  const BURST = AI_CALL_WINDOWS.find((window) => window.label === 'minute')!.max

  it('stops calling the provider once the caller has had their burst', async () => {
    const ai = provider({ ok: true, value: GOOD })
    setAiProvider(ai)

    for (let i = 0; i < BURST; i++) {
      expect((await readMeterPhotoAction({}, form(photo(64)))).suggestion).toEqual(GOOD)
    }
    expect(ai.run).toHaveBeenCalledTimes(BURST)

    const state = await readMeterPhotoAction({}, form(photo(64)))

    // The whole point: the refusal lands BEFORE the money is spent.
    expect(state.suggestion).toBeUndefined()
    expect(state.unavailable).toMatch(/type the numbers in/i)
    expect(ai.run).toHaveBeenCalledTimes(BURST)
  })

  it('still writes nothing when it is the limit doing the refusing', async () => {
    for (let i = 0; i <= BURST; i++) await readMeterPhotoAction({}, form(photo(64)))

    expect(meters.saveReadings).not.toHaveBeenCalled()
    expect(cache.revalidatePath).not.toHaveBeenCalled()
  })

  it('does not spend the round on uploads that were never going to cost anything', async () => {
    const ai = provider({ ok: true, value: GOOD })
    setAiProvider(ai)

    // A pocketful of videos: refused before the provider, so refused before the
    // counter. An operator fumbling the picker keeps their whole allowance.
    for (let i = 0; i < BURST * 2; i++) {
      await readMeterPhotoAction({}, form(photo(64, 'video/mp4')))
    }

    expect((await readMeterPhotoAction({}, form(photo(64)))).suggestion).toEqual(GOOD)
  })
})
