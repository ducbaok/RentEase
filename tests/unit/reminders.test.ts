import { describe, expect, it } from 'vitest'
import { addDays, remindersDue, REMINDER_SCHEDULE } from '@/lib/domain/reminders'
import type { InvoiceStatus } from '@/lib/domain/invoice-status'

/**
 * The reminder schedule, boundary by boundary.
 *
 * The four traps this table is built to catch, all named in the stream brief:
 *   - the due date is NOT late and NOT a reminder day (AC6.3)
 *   - the three windows fire on exactly due-3, due+1, due+7 and nowhere else
 *   - a paid invoice is never chased, even in a window (AC6.1)
 *   - an invoice that is both partial and overdue is still chased
 */

const DUE = '2026-09-05'

describe('addDays', () => {
  it('shifts forward and backward across month and year boundaries', () => {
    expect(addDays('2026-09-05', -3)).toBe('2026-09-02')
    expect(addDays('2026-09-05', 1)).toBe('2026-09-06')
    expect(addDays('2026-09-05', 7)).toBe('2026-09-12')
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    // Leap day, computed in UTC so it never drifts by the reader's timezone.
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('rejects a malformed date instead of guessing', () => {
    expect(() => addDays('2026-9-5', 1)).toThrow()
    expect(() => addDays('not-a-date', 1)).toThrow()
  })
})

describe('remindersDue — the windows', () => {
  const cases: Array<{ name: string; asOf: string; expected: string[] }> = [
    { name: 'four days before due — too early, nothing', asOf: '2026-09-01', expected: [] },
    { name: 'exactly three days before — before_due', asOf: '2026-09-02', expected: ['before_due'] },
    { name: 'two days before — nothing', asOf: '2026-09-03', expected: [] },
    { name: 'the due date itself is on time — nothing', asOf: DUE, expected: [] },
    { name: 'one day after due — overdue_1', asOf: '2026-09-06', expected: ['overdue_1'] },
    { name: 'two days after — nothing', asOf: '2026-09-07', expected: [] },
    { name: 'six days after — nothing', asOf: '2026-09-11', expected: [] },
    { name: 'seven days after due — overdue_7', asOf: '2026-09-12', expected: ['overdue_7'] },
    { name: 'eight days after — the chasing stops', asOf: '2026-09-13', expected: [] },
  ]

  for (const { name, asOf, expected } of cases) {
    it(name, () => {
      expect(remindersDue({ status: 'sent', dueDate: DUE }, asOf)).toEqual(expected)
    })
  }
})

describe('remindersDue — which invoices are chaseable (AC6.1)', () => {
  // A window day for each check, so only the status varies.
  const onBeforeDue = '2026-09-02'
  const onOverdue1 = '2026-09-06'

  it('a paid invoice is never chased, even inside a window', () => {
    expect(remindersDue({ status: 'paid', dueDate: DUE }, onBeforeDue)).toEqual([])
    expect(remindersDue({ status: 'paid', dueDate: DUE }, onOverdue1)).toEqual([])
  })

  it('a draft invoice — not yet issued — is never chased', () => {
    expect(remindersDue({ status: 'draft', dueDate: DUE }, onBeforeDue)).toEqual([])
    expect(remindersDue({ status: 'draft', dueDate: DUE }, onOverdue1)).toEqual([])
  })

  it('a partially paid, past-due invoice is still chased', () => {
    // 'overdue' outranks 'partial' in the status rule, so this is what a
    // half-paid late invoice actually looks like. It still owes money.
    expect(remindersDue({ status: 'overdue', dueDate: DUE }, onOverdue1)).toEqual(['overdue_1'])
  })

  it('a partial invoice before its due date is chased on the before_due day', () => {
    expect(remindersDue({ status: 'partial', dueDate: DUE }, onBeforeDue)).toEqual(['before_due'])
  })

  it('every non-paid, non-draft status is chaseable in its window', () => {
    const chaseable: InvoiceStatus[] = ['sent', 'partial', 'overdue']
    for (const status of chaseable) {
      expect(remindersDue({ status, dueDate: DUE }, onOverdue1)).toEqual(['overdue_1'])
    }
  })
})

describe('the schedule matches the reminder_kind enum', () => {
  it('names exactly the three enum values, once each', () => {
    expect(REMINDER_SCHEDULE.map((r) => r.kind).sort()).toEqual([
      'before_due',
      'overdue_1',
      'overdue_7',
    ])
  })

  it('the due date is never one of the fire days', () => {
    for (const { offsetDays } of REMINDER_SCHEDULE) {
      expect(offsetDays).not.toBe(0)
    }
  })
})
