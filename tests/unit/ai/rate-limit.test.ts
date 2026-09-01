import { beforeEach, describe, expect, it } from 'vitest'
import { AI_CALL_WINDOWS, recordAiCall, resetAiRateLimit } from '@/lib/ai/rate-limit'

/**
 * The brake on the Anthropic bill.
 *
 * Every window is asserted against `now` passed in rather than a real clock, so
 * the hour-long rule is tested in a millisecond and the suite never waits for
 * anything. The limits themselves are read out of AI_CALL_WINDOWS rather than
 * written down again here — a test that restates the number it is checking
 * fails to notice the day somebody changes it.
 */

const MINUTE = AI_CALL_WINDOWS.find((window) => window.label === 'minute')!
const HOUR = AI_CALL_WINDOWS.find((window) => window.label === 'hour')!

const T0 = 1_700_000_000_000

/** Spends `count` calls for `key`, spread far enough apart to stay in `window`. */
function spend(key: string, count: number, from: number, stepMs: number): number {
  let at = from
  for (let i = 0; i < count; i++) {
    recordAiCall(key, at)
    at += stepMs
  }
  return at
}

describe('recordAiCall', () => {
  beforeEach(() => resetAiRateLimit())

  it('lets a monthly round through — the limits are above real use, not near it', () => {
    // Fifty units, both dials in one shot, a handful of retakes, one every
    // fifteen seconds. Nothing about that should meet a limit.
    let at = T0
    for (let i = 0; i < 60; i++) {
      expect(recordAiCall('user-1', at).ok, `call ${i + 1} was refused`).toBe(true)
      at += 15_000
    }
  })

  it('refuses the call after the burst limit and says how long to wait', () => {
    for (let i = 0; i < MINUTE.max; i++) {
      expect(recordAiCall('user-1', T0 + i).ok).toBe(true)
    }

    const verdict = recordAiCall('user-1', T0 + MINUTE.max)
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.retryAfterMs).toBeGreaterThan(0)
    expect(verdict.ok === false && verdict.retryAfterMs).toBeLessThanOrEqual(MINUTE.ms)
  })

  it('lets the burst through again once the window has rolled past', () => {
    for (let i = 0; i < MINUTE.max; i++) recordAiCall('user-1', T0 + i)
    expect(recordAiCall('user-1', T0 + MINUTE.max).ok).toBe(false)

    expect(recordAiCall('user-1', T0 + MINUTE.ms + 1).ok).toBe(true)
  })

  it('holds the hourly ceiling even when nobody ever bursts', () => {
    // Slow and patient: one call every ten seconds never meets the minute rule.
    const step = 10_000
    const at = spend('user-1', HOUR.max, T0, step)

    const verdict = recordAiCall('user-1', at)
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.retryAfterMs).toBeGreaterThan(MINUTE.ms)
  })

  it('counts each caller separately — one busy operator does not stop another', () => {
    for (let i = 0; i < MINUTE.max; i++) recordAiCall('user-1', T0 + i)
    expect(recordAiCall('user-1', T0 + MINUTE.max).ok).toBe(false)

    expect(recordAiCall('user-2', T0 + MINUTE.max).ok).toBe(true)
  })

  it('does not extend its own ban when the refused caller keeps knocking', () => {
    for (let i = 0; i < MINUTE.max; i++) recordAiCall('user-1', T0 + i)

    // A script hammering all the way to the end of the window.
    for (let at = T0 + MINUTE.max; at < T0 + MINUTE.ms; at += 100) {
      expect(recordAiCall('user-1', at).ok).toBe(false)
    }

    // The window still expires on schedule: refusals were not recorded.
    expect(recordAiCall('user-1', T0 + MINUTE.ms + 1).ok).toBe(true)
  })

  it('is forgotten by the reset seam, so tests cannot leak counts into each other', () => {
    for (let i = 0; i < MINUTE.max; i++) recordAiCall('user-1', T0 + i)
    expect(recordAiCall('user-1', T0 + MINUTE.max).ok).toBe(false)

    resetAiRateLimit()
    expect(recordAiCall('user-1', T0 + MINUTE.max).ok).toBe(true)
  })

  it('never throws, whatever it is handed', () => {
    expect(() => recordAiCall('', T0)).not.toThrow()
    expect(() => recordAiCall('user-1', 0)).not.toThrow()
    expect(() => recordAiCall('user-1', -1)).not.toThrow()
  })
})
