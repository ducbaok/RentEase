import { describe, expect, it } from 'vitest'
import {
  averageConsumption,
  detectFlags,
  isDecrease,
  isMeterFlag,
  isSpike,
  MIN_PERIODS_FOR_SPIKE,
  parseFlags,
  requiresConfirmation,
  SPIKE_MULTIPLIER,
} from '@/lib/domain/anomaly'

/**
 * The two things a landlord must not learn about from a resident's complaint:
 * a reading that went backwards (AC3.1) and one that is wildly out of line for
 * that unit (AC3.2).
 */

describe('isDecrease', () => {
  it('is true only when the meter reads lower than last month', () => {
    expect(isDecrease({ prev: 2047, curr: 1200 })).toBe(true)
    expect(isDecrease({ prev: 2047, curr: 2047 })).toBe(false)
    expect(isDecrease({ prev: 2047, curr: 2048 })).toBe(false)
  })

  it('does not fire on floating-point noise between two equal readings', () => {
    expect(isDecrease({ prev: 0.1 + 0.2, curr: 0.3 })).toBe(false)
  })
})

describe('averageConsumption', () => {
  it('needs more than one month before "normal for this unit" means anything', () => {
    expect(averageConsumption([600])).toBeNull()
    expect(MIN_PERIODS_FOR_SPIKE).toBe(2)
  })

  it('averages the months it has', () => {
    expect(averageConsumption([600, 700, 500])).toBe(600)
  })

  it('drops rollover months instead of averaging a negative in', () => {
    // Without the filter the mean would be 200, and an ordinary 700 kWh month
    // would then be flagged as a spike.
    expect(averageConsumption([600, 700, -700])).toBe(650)
  })

  it('returns null when every month was zero — nothing is 3× nothing', () => {
    expect(averageConsumption([0, 0, 0])).toBeNull()
  })

  it('returns null when the rollovers leave too few usable months', () => {
    expect(averageConsumption([-5, 600])).toBeNull()
  })
})

describe('isSpike', () => {
  const history = [600, 700, 500] // average 600

  it('fires above three times the usual', () => {
    expect(SPIKE_MULTIPLIER).toBe(3)
    expect(isSpike(1801, history)).toBe(true)
  })

  it('does not fire at exactly three times — "about 3×" is a ceiling, not a trap', () => {
    expect(isSpike(1800, history)).toBe(false)
  })

  it('does not fire on an ordinary hot month', () => {
    expect(isSpike(900, history)).toBe(false)
  })

  it('stays quiet for a unit with no history rather than flagging its first bill', () => {
    expect(isSpike(50_000, [])).toBe(false)
    expect(isSpike(50_000, [600])).toBe(false)
  })

  it('stays quiet for a unit that has never used anything', () => {
    // A vacant unit reads 0, 0 — the next resident is not an anomaly.
    expect(isSpike(400, [0, 0])).toBe(false)
  })
})

describe('detectFlags', () => {
  const history = { electric: [600, 700, 500], water: [300, 350, 250] }

  it('finds nothing wrong with an ordinary month', () => {
    expect(
      detectFlags(
        { electric: { prev: 2047, curr: 2650 }, water: { prev: 3450, curr: 3760 } },
        history,
      ),
    ).toEqual([])
  })

  it('flags each meter independently', () => {
    expect(
      detectFlags(
        { electric: { prev: 2047, curr: 1000 }, water: { prev: 3450, curr: 3760 } },
        history,
      ),
    ).toEqual(['electric_decreased'])

    expect(
      detectFlags(
        { electric: { prev: 2047, curr: 2650 }, water: { prev: 3450, curr: 2000 } },
        history,
      ),
    ).toEqual(['water_decreased'])
  })

  it('can report a decrease on one meter and a spike on the other', () => {
    expect(
      detectFlags(
        { electric: { prev: 2047, curr: 1000 }, water: { prev: 3450, curr: 5000 } },
        history,
      ),
    ).toEqual(['electric_decreased', 'water_spike'])
  })

  it('returns flags in a stable order so a re-save does not churn the stored array', () => {
    const flags = detectFlags(
      { electric: { prev: 2047, curr: 1000 }, water: { prev: 3450, curr: 2000 } },
      history,
    )
    expect(flags).toEqual(['electric_decreased', 'water_decreased'])
  })
})

describe('requiresConfirmation', () => {
  it('blocks on a decrease — AC3.1 refuses to save one silently', () => {
    expect(requiresConfirmation(['electric_decreased'])).toBe(true)
    expect(requiresConfirmation(['water_decreased'])).toBe(true)
  })

  it('lets a spike through, because a spike is plausible and travels to the pre-issue review', () => {
    expect(requiresConfirmation(['electric_spike', 'water_spike'])).toBe(false)
    expect(requiresConfirmation([])).toBe(false)
  })
})

describe('reading flags back out of the database', () => {
  it('keeps the flags it knows and drops anything else', () => {
    expect(parseFlags(['electric_spike', 'nonsense', 42])).toEqual(['electric_spike'])
  })

  it('survives a null or missing column', () => {
    expect(parseFlags(null)).toEqual([])
    expect(parseFlags(undefined)).toEqual([])
  })

  it('recognises exactly the four documented flags', () => {
    expect(isMeterFlag('water_decreased')).toBe(true)
    expect(isMeterFlag('gas_spike')).toBe(false)
  })
})
