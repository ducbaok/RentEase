import { describe, expect, it } from 'vitest'
import {
  assertPeriod,
  currentPeriod,
  formatPeriod,
  isPeriod,
  nextPeriod,
  periodEndDate,
  periodOf,
  periodStartDate,
  previousPeriod,
} from '@/lib/domain/period'

describe('isPeriod', () => {
  it.each(['2026-01', '2026-08', '2026-12', '1999-06'])('accepts %s', (value) => {
    expect(isPeriod(value)).toBe(true)
  })

  // These are the same rejections the billing_period domain makes in the
  // database, so a malformed period can never reach the unique constraints
  // that protect against duplicate invoices.
  it.each(['2026-00', '2026-13', '2026-8', '26-08', '2026/08', '2026-08-01', '', 'august'])(
    'rejects %s',
    (value) => {
      expect(isPeriod(value)).toBe(false)
    },
  )

  it('rejects non-strings', () => {
    expect(isPeriod(202608)).toBe(false)
    expect(isPeriod(null)).toBe(false)
  })
})

describe('assertPeriod', () => {
  it('returns the period when valid', () => {
    expect(assertPeriod('2026-08')).toBe('2026-08')
  })

  it('throws on a malformed period', () => {
    expect(() => assertPeriod('2026-13')).toThrow(/Invalid billing period/)
  })
})

describe('periodOf / currentPeriod', () => {
  it('reads the period in UTC', () => {
    expect(periodOf(new Date('2026-08-25T12:00:00Z'))).toBe('2026-08')
  })

  it('does not roll into the next month for a late-evening UTC time', () => {
    expect(periodOf(new Date('2026-08-31T23:59:00Z'))).toBe('2026-08')
  })

  it('pads single-digit months', () => {
    expect(periodOf(new Date('2026-03-01T00:00:00Z'))).toBe('2026-03')
  })

  it('currentPeriod uses the supplied clock', () => {
    expect(currentPeriod(new Date('2027-01-15T00:00:00Z'))).toBe('2027-01')
  })
})

describe('previousPeriod / nextPeriod', () => {
  it('steps back within a year', () => {
    expect(previousPeriod('2026-08')).toBe('2026-07')
  })

  it('steps back across the year boundary', () => {
    expect(previousPeriod('2026-01')).toBe('2025-12')
  })

  it('steps forward across the year boundary', () => {
    expect(nextPeriod('2026-12')).toBe('2027-01')
  })

  it('round-trips', () => {
    expect(nextPeriod(previousPeriod('2026-08'))).toBe('2026-08')
  })
})

describe('periodStartDate / periodEndDate', () => {
  it('bounds a 31-day month', () => {
    expect(periodStartDate('2026-08')).toBe('2026-08-01')
    expect(periodEndDate('2026-08')).toBe('2026-08-31')
  })

  it('bounds a 30-day month', () => {
    expect(periodEndDate('2026-09')).toBe('2026-09-30')
  })

  it('bounds a non-leap February', () => {
    expect(periodEndDate('2026-02')).toBe('2026-02-28')
  })

  it('bounds a leap February', () => {
    expect(periodEndDate('2028-02')).toBe('2028-02-29')
  })
})

describe('formatPeriod', () => {
  it('reads as a month and year', () => {
    expect(formatPeriod('2026-08')).toBe('August 2026')
  })

  it('does not slip a month for timezone reasons', () => {
    expect(formatPeriod('2026-01')).toBe('January 2026')
    expect(formatPeriod('2026-12')).toBe('December 2026')
  })
})
