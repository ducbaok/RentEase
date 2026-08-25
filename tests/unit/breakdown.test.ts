import { describe, expect, it } from 'vitest'
import {
  breakdownTotalCents,
  isMeteredLine,
  parseBreakdown,
  type Breakdown,
} from '@/lib/domain/breakdown'

/** The worked example from the brief, as it is stored on an invoice. */
const DANA_JULY: Breakdown = [
  { kind: 'rent', label: 'Rent', amount_cents: 120000 },
  {
    kind: 'electric',
    label: 'Electricity',
    prev: 1420,
    curr: 2047,
    consumption: 627,
    unit: 'kWh',
    rate: 0.14,
    amount_cents: 8778,
  },
  {
    kind: 'water',
    label: 'Water',
    prev: 3100,
    curr: 3450,
    consumption: 350,
    unit: 'gal',
    rate: 0.012,
    amount_cents: 420,
  },
  { kind: 'service', label: 'Service fee', amount_cents: 2500 },
]

describe('parseBreakdown', () => {
  it('reads a well-formed breakdown', () => {
    expect(parseBreakdown(DANA_JULY)).toHaveLength(4)
  })

  it('reads it back after a JSON round trip, as it comes from jsonb', () => {
    expect(parseBreakdown(JSON.parse(JSON.stringify(DANA_JULY)))).toEqual(DANA_JULY)
  })

  it('treats an empty breakdown as empty', () => {
    expect(parseBreakdown([])).toEqual([])
  })

  // An unreadable breakdown must degrade the invoice to showing its totals,
  // never make the invoice unopenable — a resident locked out of their own
  // bill is worse than a bill without its working shown.
  it.each([null, undefined, 'nonsense', 42, { kind: 'rent' }, [{ kind: 'mystery' }]])(
    'returns an empty breakdown rather than throwing on %s',
    (value) => {
      expect(parseBreakdown(value)).toEqual([])
    },
  )

  it('rejects a metered line that is missing its meter numbers', () => {
    expect(
      parseBreakdown([{ kind: 'electric', label: 'Electricity', amount_cents: 100 }]),
    ).toEqual([])
  })
})

describe('breakdownTotalCents', () => {
  it('adds up to the invoice total', () => {
    expect(breakdownTotalCents(DANA_JULY)).toBe(131698)
  })

  it('is zero for an empty breakdown', () => {
    expect(breakdownTotalCents([])).toBe(0)
  })
})

describe('isMeteredLine', () => {
  it('identifies the lines that carry meter readings', () => {
    const metered = DANA_JULY.filter(isMeteredLine)
    expect(metered.map((line) => line.kind)).toEqual(['electric', 'water'])
  })

  it('the arithmetic on each metered line is self-consistent', () => {
    for (const line of DANA_JULY.filter(isMeteredLine)) {
      expect(line.curr - line.prev).toBe(line.consumption)
      expect(Math.round(line.consumption * line.rate * 100)).toBe(line.amount_cents)
    }
  })
})
