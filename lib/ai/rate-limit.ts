/**
 * A ceiling on how often one operator can spend our money.
 *
 * readMeterPhotoAction is the first thing in this product where a request costs
 * cash rather than CPU — roughly two cents of Anthropic tokens per photo (D25).
 * requireOperator() answers "who is this", which is the right question to ask
 * about data and the wrong one to ask about cost: the landing page publishes
 * working demo credentials (D23), so "a signed-in operator" includes anybody
 * who can read the home page.
 *
 * The media-type check and the size cap in the action bound what ONE call
 * costs. This bounds how many of them there are.
 *
 * WHAT THIS IS NOT. It counts in memory, in one process. A platform that keeps
 * several instances warm multiplies the effective limit by however many are
 * serving, and a cold start forgets everything. So this is a brake on a
 * runaway, not an access control, and it is written down here so that nobody
 * later reads it as one. The durable version is a counter in the database,
 * which needs a migration and therefore a batch of its own (D7).
 *
 * Nothing here throws, and nothing here is async: a fault in the cost brake
 * must not become a fault in the meter screen (AC9.5).
 */

interface Window {
  readonly label: string
  readonly ms: number
  readonly max: number
}

/**
 * Two windows, because the two things being defended against have different
 * shapes. The minute catches a script: a person walking a corridor cannot
 * photograph twenty meters in a minute, and a loop can do twenty in a second.
 * The hour catches a slow drain that stays under the burst limit all day.
 *
 * Both are set well above a real monthly round. Fifty units with retakes is
 * comfortably inside 150, and that round takes far longer than an hour anyway.
 */
export const AI_CALL_WINDOWS: readonly Window[] = [
  { label: 'minute', ms: 60_000, max: 20 },
  { label: 'hour', ms: 3_600_000, max: 150 },
]

const LONGEST_MS = Math.max(...AI_CALL_WINDOWS.map((window) => window.ms))

/**
 * How many keys may be remembered before the sweep runs. Each key holds at
 * most `max` timestamps of the longest window, so the memory this can hold is
 * bounded and small; the sweep exists so the map does not accumulate a row per
 * account that ever took one photo.
 */
const SWEEP_ABOVE = 500

/*
 * Held on globalThis for the same measured reason as the provider slot in
 * lib/ai/provider.ts: this module is bundled more than once, and a per-bundle
 * variable would give each copy its own private count — which is a limit that
 * does not limit.
 */
const CALLS = Symbol.for('rentease.ai.rateLimit')

type Slot = { [CALLS]?: Map<string, number[]> }

function store(): Map<string, number[]> {
  const slot = globalThis as Slot
  slot[CALLS] ??= new Map()
  return slot[CALLS]
}

/** Forgets keys that have gone quiet, so the map cannot grow without end. */
function sweep(calls: Map<string, number[]>, now: number): void {
  if (calls.size < SWEEP_ABOVE) return
  for (const [key, at] of calls) {
    if (at.every((moment) => now - moment >= LONGEST_MS)) calls.delete(key)
  }
}

export type RateVerdict = { ok: true } | { ok: false; retryAfterMs: number }

/**
 * Records one call against `key` and says whether it was allowed.
 *
 * `now` is a parameter rather than a Date.now() inside, so an hour-long window
 * can be tested without waiting an hour.
 *
 * A refused call is NOT recorded. Counting refusals would let a script hold its
 * own ban open forever by continuing to knock, which punishes the one case that
 * is not an attack: an operator whose finger slipped on a fast connection.
 */
export function recordAiCall(key: string, now: number): RateVerdict {
  const calls = store()
  sweep(calls, now)

  const recent = (calls.get(key) ?? []).filter((moment) => now - moment < LONGEST_MS)

  for (const window of AI_CALL_WINDOWS) {
    const inWindow = recent.filter((moment) => now - moment < window.ms)
    if (inWindow.length >= window.max) {
      calls.set(key, recent)
      // The oldest call in this window is the one that has to age out before
      // there is room for another.
      return { ok: false, retryAfterMs: window.ms - (now - Math.min(...inWindow)) }
    }
  }

  recent.push(now)
  calls.set(key, recent)
  return { ok: true }
}

/** Test seam: forgets every count. Mirrors setAiProvider(null). */
export function resetAiRateLimit(): void {
  ;(globalThis as Slot)[CALLS] = new Map()
}
