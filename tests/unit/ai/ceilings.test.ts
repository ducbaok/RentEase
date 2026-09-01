import { describe, expect, it, vi } from 'vitest'

/*
 * lib/env.ts validates the Supabase variables at module load and the action's
 * module reaches it through @/lib/auth. Same reason as the sibling files.
 */
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon-key-not-used-by-these-tests'
})

const meters = vi.hoisted(() => ({
  saveReadings: vi.fn(async () => ({ saved: 1, updated: 0, needsConfirmation: [] })),
  getMeterSheet: vi.fn(),
  listReadingAudit: vi.fn(),
}))
vi.mock('@/lib/data/meters', () => meters)

vi.mock('@/lib/auth', () => ({
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { saveReadingsAction } from '@/app/(dashboard)/meters/actions'
import { MAX_METER_READING, meterReadingSchema } from '@/lib/ai/schemas'

/**
 * "How large may a meter reading be" is answered in two places — by the zod
 * schema a suggestion must fit (lib/ai/schemas.ts) and by the number schema the
 * submitted form must fit (app/(dashboard)/meters/actions.ts). Two places, one
 * concept: exactly the shape that produced B3-6.
 *
 * They cannot be collapsed into one constant without pointing one module at the
 * other in a direction neither should depend on — `'use server'` forbids the
 * action from exporting a constant at all, and the AI layer has no business
 * owning what the manual keyboard path accepts. So they are held together from
 * the outside instead, behaviourally: whatever the AI is permitted to suggest,
 * this file proves the form will store, and whatever the AI refuses, this file
 * proves the form refuses too.
 *
 * It fails if either ceiling moves without the other, which is the only failure
 * that matters. It does not compare the two literals, because equal numbers in
 * two files is what drifted in the first place — what is asserted here is that
 * the same VALUES get the same answer at both ends.
 */

function sheet(reading: number): FormData {
  const data = new FormData()
  data.set('period', '2026-08')
  data.set('electric-unit-1', String(reading))
  data.set('water-unit-1', String(reading))
  return data
}

describe('the ceiling a suggestion may reach and the ceiling the form will save', () => {
  it('the largest suggestion the AI may offer fits the schema', () => {
    const parsed = meterReadingSchema.safeParse({
      electric: MAX_METER_READING,
      water: MAX_METER_READING,
      confidence: 'high',
    })

    expect(parsed.success).toBe(true)
  })

  it('and the form saves that same number', async () => {
    meters.saveReadings.mockClear()

    const state = await saveReadingsAction({}, sheet(MAX_METER_READING))

    // The point of the file: nothing the AI can put in the box is a number the
    // save path will then blame the operator for.
    expect(state.error).toBeUndefined()
    expect(meters.saveReadings).toHaveBeenCalledTimes(1)
  })

  it('one more than that is refused by the AI layer', () => {
    const parsed = meterReadingSchema.safeParse({
      electric: MAX_METER_READING + 1,
      water: 0,
      confidence: 'high',
    })

    expect(parsed.success).toBe(false)
  })

  it('and one more than that is refused by the form too — the ceilings coincide', async () => {
    meters.saveReadings.mockClear()

    const state = await saveReadingsAction({}, sheet(MAX_METER_READING + 1))

    // If the form's ceiling were HIGHER than the AI's, this would save and the
    // AI would be needlessly timid. If it were LOWER, the previous test would
    // already have failed. Both directions are pinned.
    expect(state.error).toBeDefined()
    expect(meters.saveReadings).not.toHaveBeenCalled()
  })
})
