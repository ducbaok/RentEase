import { describe, expect, it } from 'vitest'
import {
  computeInvoiceStatus,
  isChaseable,
  outstandingCents,
  todayUtc,
  type InvoiceStatus,
} from '@/lib/domain/invoice-status'

/**
 * The status rule, case by case.
 *
 * This table is the TypeScript half of a mirrored pair — the other half is
 * `public.compute_invoice_status` in migration 0900, tested by the same cases in
 * supabase/tests/invariants.test.sql. Both must be updated together, because the
 * database copy is what actually gets stored and this copy is what the UI
 * promises will happen.
 */
const CASES: Array<{
  name: string
  issuedAt: string | null
  totalCents: number
  paidCents: number
  dueDate: string
  asOf: string
  expected: InvoiceStatus
}> = [
  {
    name: 'not issued yet',
    issuedAt: null,
    totalCents: 131698,
    paidCents: 0,
    dueDate: '2026-08-05',
    asOf: '2026-08-25',
    expected: 'draft',
  },
  {
    name: 'not issued, and somehow already paid — still a draft',
    issuedAt: null,
    totalCents: 100,
    paidCents: 100,
    dueDate: '2026-08-05',
    asOf: '2026-08-01',
    expected: 'draft',
  },
  {
    name: 'issued, nothing paid, not due yet',
    issuedAt: '2026-08-01T09:00:00Z',
    totalCents: 131698,
    paidCents: 0,
    dueDate: '2026-09-05',
    asOf: '2026-08-25',
    expected: 'sent',
  },
  {
    name: 'part paid, not due yet',
    issuedAt: '2026-08-01T09:00:00Z',
    totalCents: 112348,
    paidCents: 50000,
    dueDate: '2026-09-05',
    asOf: '2026-08-25',
    expected: 'partial',
  },
  {
    name: 'paid exactly',
    issuedAt: '2026-08-01T09:00:00Z',
    totalCents: 131698,
    paidCents: 131698,
    dueDate: '2026-08-05',
    asOf: '2026-08-25',
    expected: 'paid',
  },
  {
    name: 'overpaid — still paid, never a different state',
    issuedAt: '2026-08-01T09:00:00Z',
    totalCents: 131698,
    paidCents: 140000,
    dueDate: '2026-08-05',
    asOf: '2026-08-25',
    expected: 'paid',
  },
  {
    name: 'nothing paid, past due',
    issuedAt: '2026-08-01T09:00:00Z',
    totalCents: 104752,
    paidCents: 0,
    dueDate: '2026-08-05',
    asOf: '2026-08-25',
    expected: 'overdue',
  },
  {
    name: 'part paid AND past due — overdue outranks partial, they still owe',
    issuedAt: '2026-08-01T09:00:00Z',
    totalCents: 112348,
    paidCents: 50000,
    dueDate: '2026-08-05',
    asOf: '2026-08-25',
    expected: 'overdue',
  },
  {
    name: 'paid in full but past due — settled is settled, never chased',
    issuedAt: '2026-08-01T09:00:00Z',
    totalCents: 112348,
    paidCents: 112348,
    dueDate: '2026-08-05',
    asOf: '2026-09-30',
    expected: 'paid',
  },
  {
    name: 'on the due date itself — due today is not late',
    issuedAt: '2026-08-01T09:00:00Z',
    totalCents: 100000,
    paidCents: 0,
    dueDate: '2026-08-05',
    asOf: '2026-08-05',
    expected: 'sent',
  },
  {
    name: 'the day after the due date',
    issuedAt: '2026-08-01T09:00:00Z',
    totalCents: 100000,
    paidCents: 0,
    dueDate: '2026-08-05',
    asOf: '2026-08-06',
    expected: 'overdue',
  },
  {
    name: 'a zero-total invoice counts as paid',
    issuedAt: '2026-08-01T09:00:00Z',
    totalCents: 0,
    paidCents: 0,
    dueDate: '2026-08-05',
    asOf: '2026-09-30',
    expected: 'paid',
  },
]

describe('computeInvoiceStatus', () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      expect(computeInvoiceStatus(testCase)).toBe(testCase.expected)
    })
  }

  it('accepts a Date for issuedAt as well as a string', () => {
    expect(
      computeInvoiceStatus({
        issuedAt: new Date('2026-08-01T09:00:00Z'),
        totalCents: 1000,
        paidCents: 0,
        dueDate: '2026-09-05',
        asOf: '2026-08-25',
      }),
    ).toBe('sent')
  })

  it('crossing a year boundary compares correctly', () => {
    expect(
      computeInvoiceStatus({
        issuedAt: '2026-12-01T00:00:00Z',
        totalCents: 1000,
        paidCents: 0,
        dueDate: '2026-12-31',
        asOf: '2027-01-01',
      }),
    ).toBe('overdue')
  })
})

describe('outstandingCents', () => {
  it('is the remaining balance', () => {
    expect(outstandingCents(112348, 50000)).toBe(62348)
  })

  it('never goes negative when someone overpays', () => {
    expect(outstandingCents(100, 500)).toBe(0)
  })
})

describe('isChaseable', () => {
  it('never chases a paid invoice — the rule the product is judged on', () => {
    expect(isChaseable('paid')).toBe(false)
  })

  it('does not chase a draft, which the resident has never seen', () => {
    expect(isChaseable('draft')).toBe(false)
  })

  it.each(['sent', 'partial', 'overdue'] as const)('chases %s', (status) => {
    expect(isChaseable(status)).toBe(true)
  })
})

describe('todayUtc', () => {
  it('formats as YYYY-MM-DD in UTC, matching the database current_date', () => {
    expect(todayUtc(new Date('2026-08-25T23:30:00Z'))).toBe('2026-08-25')
  })

  it('does not shift the day for a late-evening local time', () => {
    expect(todayUtc(new Date('2026-08-25T00:15:00Z'))).toBe('2026-08-25')
  })
})
