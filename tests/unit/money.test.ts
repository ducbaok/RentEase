import { describe, expect, it } from 'vitest'
import { formatCents, lineAmountCents, parseAmountToCents } from '@/lib/domain/money'

describe('formatCents', () => {
  it('formats a whole invoice total', () => {
    expect(formatCents(131698)).toBe('$1,316.98')
  })

  it('keeps both decimal places for round amounts', () => {
    expect(formatCents(2500)).toBe('$25.00')
  })

  it('formats zero', () => {
    expect(formatCents(0)).toBe('$0.00')
  })
})

describe('parseAmountToCents', () => {
  it.each([
    ['1316.98', 131698],
    ['1,316.98', 131698],
    ['$1,316.98', 131698],
    ['1316', 131600],
    ['0.05', 5],
    ['  25.00  ', 2500],
  ])('reads %s as %d cents', (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected)
  })

  it('rounds to whole cents rather than carrying a fraction forward', () => {
    expect(parseAmountToCents('10.005')).toBe(1001)
  })

  // Returning null rather than 0 matters: a caller must decide what an
  // unreadable amount means. Silently recording a payment of $0.00 because
  // someone typed "abc" is exactly the kind of quiet wrongness to avoid.
  it.each(['', 'abc', '12.3.4', '--5', '$'])('refuses to guess at %s', (input) => {
    expect(parseAmountToCents(input)).toBeNull()
  })
})

describe('lineAmountCents', () => {
  it('matches the worked example from the brief: 627 kWh at $0.14', () => {
    expect(lineAmountCents(627, 0.14)).toBe(8778)
  })

  it('handles a four-decimal tariff', () => {
    expect(lineAmountCents(627, 0.1425)).toBe(8935)
  })

  it('handles water at a fraction of a cent per gallon', () => {
    expect(lineAmountCents(350, 0.012)).toBe(420)
  })

  it('is zero when nothing was consumed', () => {
    expect(lineAmountCents(0, 0.14)).toBe(0)
  })

  // Floating-point drift is the failure this guards against: 0.1 * 3 is
  // 0.30000000000000004, and a rent roll must not inherit that.
  it('rounds once at the line rather than accumulating drift', () => {
    expect(lineAmountCents(3, 0.1)).toBe(30)
    expect(lineAmountCents(1.15, 1)).toBe(115)
  })
})
