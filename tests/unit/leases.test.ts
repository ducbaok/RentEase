import { describe, expect, it } from 'vitest'
import {
  MAX_BILLING_DAY,
  findConflictingLease,
  formatIsoDate,
  formatTerm,
  isIsoDate,
  occupancySummary,
  occupiesOn,
  termsOverlap,
  todayIso,
  unitStatusFromLeases,
  validateLeaseDraft,
  validateLeaseEnd,
  type LeaseDraft,
  type LeaseTerm,
} from '@/lib/domain/leases'

/**
 * The cases that matter here are the boundaries, because that is where money
 * and occupancy get decided: the day a lease starts, the day it ends, and the
 * day two leases meet. Each one is checked against what the database would do,
 * since the database is the authority (see the MIRROR WARNING in the module).
 */

const term = (
  startDate: string,
  endDate: string | null,
  status: LeaseTerm['status'] = 'active',
): LeaseTerm => ({ status, startDate, endDate })

describe('isIsoDate', () => {
  it('accepts a real calendar date', () => {
    expect(isIsoDate('2026-08-25')).toBe(true)
  })

  it('rejects a day that does not exist', () => {
    expect(isIsoDate('2026-02-31')).toBe(false)
  })

  it('rejects other shapes outright', () => {
    expect(isIsoDate('25/08/2026')).toBe(false)
    expect(isIsoDate('2026-8-5')).toBe(false)
    expect(isIsoDate('')).toBe(false)
    expect(isIsoDate(20260825)).toBe(false)
  })
})

describe('todayIso', () => {
  it('reads the date in UTC so it matches the database current_date', () => {
    // 00:30 UTC is still the previous evening in Austin. The database would
    // say the 25th, and so must we.
    expect(todayIso(new Date('2026-08-25T00:30:00Z'))).toBe('2026-08-25')
    expect(todayIso(new Date('2026-08-25T23:30:00Z'))).toBe('2026-08-25')
  })
})

describe('termsOverlap — the half of AC2.1 the screen can check first', () => {
  it('finds an overlap when one term sits inside the other', () => {
    expect(termsOverlap(term('2026-01-01', '2026-12-31'), term('2026-06-01', '2026-07-31'))).toBe(
      true,
    )
  })

  it('treats terms that touch on a single day as overlapping', () => {
    // Both ends are inclusive, like daterange(start, end, '[]'). Two residents
    // cannot both hold the keys on the 30th.
    expect(termsOverlap(term('2026-01-01', '2026-06-30'), term('2026-06-30', '2026-12-31'))).toBe(
      true,
    )
  })

  it('lets a term start the day after the previous one ends', () => {
    expect(termsOverlap(term('2026-01-01', '2026-06-30'), term('2026-07-01', '2026-12-31'))).toBe(
      false,
    )
  })

  it('treats a missing end date as unbounded in either position', () => {
    expect(termsOverlap(term('2026-01-01', null), term('2030-01-01', '2030-12-31'))).toBe(true)
    expect(termsOverlap(term('2030-01-01', '2030-12-31'), term('2026-01-01', null))).toBe(true)
    expect(termsOverlap(term('2026-01-01', null), term('2025-01-01', '2025-12-31'))).toBe(false)
  })

  it('is symmetric', () => {
    const a = term('2026-03-01', '2026-09-30')
    const b = term('2026-09-30', null)
    expect(termsOverlap(a, b)).toBe(termsOverlap(b, a))
  })
})

describe('occupiesOn — AC2.2 as the database computes it', () => {
  it('counts a lease that covers the day', () => {
    expect(occupiesOn(term('2026-01-01', '2026-12-31'), '2026-08-25')).toBe(true)
  })

  it('counts both boundary days', () => {
    expect(occupiesOn(term('2026-08-25', '2026-08-25'), '2026-08-25')).toBe(true)
  })

  it('does not count a lease that has not started yet', () => {
    // Signing next month's lease today must not report the unit as occupied —
    // the trigger checks start_date <= current_date, and so does this.
    expect(occupiesOn(term('2026-09-01', '2027-08-31'), '2026-08-25')).toBe(false)
  })

  it('does not count a lease whose end date has passed', () => {
    expect(occupiesOn(term('2026-01-01', '2026-07-31'), '2026-08-25')).toBe(false)
  })

  it('does not count an ended lease even while its dates still cover today', () => {
    expect(occupiesOn(term('2026-01-01', '2026-12-31', 'ended'), '2026-08-25')).toBe(false)
  })

  it('counts an open-ended lease that has begun', () => {
    expect(occupiesOn(term('2026-02-15', null), '2026-08-25')).toBe(true)
  })
})

describe('unitStatusFromLeases', () => {
  it('is vacant with no leases at all', () => {
    expect(unitStatusFromLeases([], '2026-08-25')).toBe('vacant')
  })

  it('is occupied if any one lease covers the day', () => {
    const leases = [term('2026-01-01', '2026-06-30'), term('2026-07-01', null)]
    expect(unitStatusFromLeases(leases, '2026-08-25')).toBe('occupied')
  })

  it('is vacant once every lease has ended', () => {
    const leases = [term('2026-01-01', '2026-06-30', 'ended'), term('2026-07-01', null, 'ended')]
    expect(unitStatusFromLeases(leases, '2026-08-25')).toBe('vacant')
  })
})

describe('findConflictingLease', () => {
  const existing = [
    { id: 'l1', ...term('2026-01-01', '2026-06-30') },
    { id: 'l2', ...term('2026-08-01', null) },
    { id: 'l3', ...term('2026-07-01', '2026-07-31', 'ended') },
  ]

  it('names the lease a new term would collide with', () => {
    expect(findConflictingLease(existing, term('2026-06-01', '2026-06-15'))?.id).toBe('l1')
  })

  it('ignores ended leases, exactly like the EXCLUDE constraint', () => {
    // l3 covers all of July but has ended, so July is free.
    expect(findConflictingLease(existing, term('2026-07-05', '2026-07-20'))).toBeNull()
  })

  it('does not report a lease as conflicting with itself when editing', () => {
    expect(findConflictingLease(existing, term('2026-08-01', null), 'l2')).toBeNull()
  })

  it('still catches a different lease while editing', () => {
    expect(findConflictingLease(existing, term('2026-01-15', '2026-02-15'), 'l2')?.id).toBe('l1')
  })
})

describe('validateLeaseDraft', () => {
  const valid: LeaseDraft = {
    unitId: 'unit-1',
    tenantId: 'tenant-1',
    startDate: '2026-09-01',
    endDate: '2027-08-31',
    rentCents: 120000,
    depositCents: 120000,
    billingDay: 5,
  }

  const fieldsFor = (draft: LeaseDraft) => validateLeaseDraft(draft).map((issue) => issue.field)

  it('passes a complete draft', () => {
    expect(validateLeaseDraft(valid)).toEqual([])
  })

  it('accepts an open-ended lease', () => {
    expect(validateLeaseDraft({ ...valid, endDate: null })).toEqual([])
    expect(validateLeaseDraft({ ...valid, endDate: '' })).toEqual([])
  })

  it('accepts a deposit of zero', () => {
    expect(validateLeaseDraft({ ...valid, depositCents: 0 })).toEqual([])
  })

  it('accepts a lease that starts and ends on the same day', () => {
    expect(validateLeaseDraft({ ...valid, startDate: '2026-09-01', endDate: '2026-09-01' })).toEqual(
      [],
    )
  })

  it('refuses an end date before the start date', () => {
    expect(fieldsFor({ ...valid, endDate: '2026-08-31' })).toEqual(['endDate'])
  })

  it('refuses negative money', () => {
    expect(fieldsFor({ ...valid, rentCents: -1 })).toEqual(['rentCents'])
    expect(fieldsFor({ ...valid, depositCents: -1 })).toEqual(['depositCents'])
  })

  it('refuses unreadable money rather than treating it as zero', () => {
    expect(fieldsFor({ ...valid, rentCents: null })).toEqual(['rentCents'])
  })

  it('refuses fractional cents', () => {
    expect(fieldsFor({ ...valid, rentCents: 1200.5 })).toEqual(['rentCents'])
  })

  it(`refuses a billing day past the ${MAX_BILLING_DAY}th, which February would not have`, () => {
    expect(fieldsFor({ ...valid, billingDay: 31 })).toEqual(['billingDay'])
    expect(fieldsFor({ ...valid, billingDay: 0 })).toEqual(['billingDay'])
    expect(validateLeaseDraft({ ...valid, billingDay: MAX_BILLING_DAY })).toEqual([])
  })

  it('reports every problem at once instead of one per submit', () => {
    expect(
      fieldsFor({ ...valid, unitId: '', tenantId: '', startDate: 'nope', billingDay: 31 }),
    ).toEqual(['unitId', 'tenantId', 'startDate', 'billingDay'])
  })
})

describe('validateLeaseEnd', () => {
  it('accepts an end date on or after the start', () => {
    expect(validateLeaseEnd(term('2026-01-01', null), '2026-08-25')).toBeNull()
    expect(validateLeaseEnd(term('2026-01-01', null), '2026-01-01')).toBeNull()
  })

  it('refuses ending before the lease began', () => {
    expect(validateLeaseEnd(term('2026-01-01', null), '2025-12-31')).toMatch(/before it started/)
  })

  it('refuses ending a lease twice', () => {
    expect(validateLeaseEnd(term('2026-01-01', '2026-06-30', 'ended'), '2026-08-25')).toMatch(
      /already ended/,
    )
  })

  it('refuses a date it cannot read', () => {
    expect(validateLeaseEnd(term('2026-01-01', null), 'today')).toMatch(/Enter the date/)
  })
})

describe('occupancySummary — AC1.1', () => {
  const units = (statuses: Array<'vacant' | 'occupied'>) => statuses.map((status) => ({ status }))

  it('reads 0% for a portfolio with no units, rather than dividing by zero', () => {
    expect(occupancySummary([])).toEqual({ total: 0, occupied: 0, vacant: 0, percent: 0 })
  })

  it('counts occupied units', () => {
    expect(occupancySummary(units(['occupied', 'vacant', 'occupied', 'vacant']))).toEqual({
      total: 4,
      occupied: 2,
      vacant: 2,
      percent: 50,
    })
  })

  it('reads 100% when everything is let', () => {
    expect(occupancySummary(units(['occupied', 'occupied'])).percent).toBe(100)
  })

  it('rounds to a whole percent', () => {
    expect(occupancySummary(units(['occupied', 'vacant', 'vacant'])).percent).toBe(33)
    expect(occupancySummary(units(['occupied', 'occupied', 'vacant'])).percent).toBe(67)
  })

  it('moves the moment one unit changes — this is what AC1.1 asks for', () => {
    const before = occupancySummary(units(['vacant', 'vacant']))
    const after = occupancySummary(units(['occupied', 'vacant']))
    expect(before.percent).toBe(0)
    expect(after.percent).toBe(50)
  })
})

describe('date formatting', () => {
  it('formats a date without shifting the day', () => {
    expect(formatIsoDate('2026-08-25')).toBe('Aug 25, 2026')
    expect(formatIsoDate('2026-01-01')).toBe('Jan 1, 2026')
  })

  it('hands back anything it cannot read instead of printing "Invalid Date"', () => {
    expect(formatIsoDate('soon')).toBe('soon')
  })

  it('says open-ended rather than leaving the end blank', () => {
    expect(formatTerm({ startDate: '2026-02-15', endDate: null })).toBe(
      'Feb 15, 2026 – open-ended',
    )
    expect(formatTerm({ startDate: '2026-01-01', endDate: '2026-12-31' })).toBe(
      'Jan 1, 2026 – Dec 31, 2026',
    )
  })
})
