/**
 * When a reminder is due — the pure rule behind the daily job (F6).
 *
 * This module decides *nothing about email* and touches no IO. Given an
 * invoice's due date and the date the job is running, it answers one question:
 * which reminders should fire today? The job (app/api/cron/reminders) is then a
 * thin shell around this — it reads invoices, calls here, and sends what comes
 * back — which is exactly what lets the whole schedule be proved with a table
 * of unit cases instead of a running database.
 *
 * The schedule (AC F6): three days BEFORE the due date, then one day and seven
 * days AFTER it.
 *
 *   due-3 ── before_due     due ── (nothing)     due+1 ── overdue_1     due+7 ── overdue_7
 *
 * The due date itself is deliberately NOT a reminder day and NOT late (AC6.3):
 * paying on the due date is paying on time, so the first overdue nudge is +1,
 * never 0.
 *
 * `kind` uses the exact vocabulary of the `reminder_kind` enum in
 * migration 0100 — 'before_due' | 'overdue_1' | 'overdue_7' — because these
 * strings are written straight into reminder_logs.kind, whose UNIQUE
 * (invoice_id, kind) is what makes the job idempotent (AC6.2).
 */

import type { InvoiceStatus } from './invoice-status'
import { isChaseable } from './invoice-status'

export type ReminderKind = 'before_due' | 'overdue_1' | 'overdue_7'

/** Day offset from the due date at which each reminder fires. */
export const REMINDER_SCHEDULE: ReadonlyArray<{ kind: ReminderKind; offsetDays: number }> = [
  { kind: 'before_due', offsetDays: -3 },
  { kind: 'overdue_1', offsetDays: 1 },
  { kind: 'overdue_7', offsetDays: 7 },
]

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86_400_000

/**
 * A 'YYYY-MM-DD' date shifted by whole days, computed in UTC and returned in the
 * same format. UTC matches how the database compares dates (see
 * invoice-status.ts): a reminder must fire on the same calendar day everywhere,
 * not a day early for a reader west of UTC.
 */
export function addDays(date: string, days: number): string {
  if (!DATE_PATTERN.test(date)) {
    throw new Error(`Invalid date "${date}". Expected YYYY-MM-DD.`)
  }
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * MS_PER_DAY)
  return shifted.toISOString().slice(0, 10)
}

export interface ReminderCandidate {
  /** The invoice's current, persisted status. */
  status: InvoiceStatus
  /** 'YYYY-MM-DD'. */
  dueDate: string
}

/**
 * Which reminders should be sent about this invoice on `asOf` ('YYYY-MM-DD').
 *
 * Returns [] for anything not chaseable — a paid or draft invoice is never
 * chased (AC6.1). Callers still re-read status at send time; the guard lives
 * here too so the rule is provable in one place. At most one kind matches a
 * given day (the offsets are distinct), but the array keeps the shape open.
 */
export function remindersDue(invoice: ReminderCandidate, asOf: string): ReminderKind[] {
  if (!isChaseable(invoice.status)) return []
  return REMINDER_SCHEDULE.filter(
    ({ offsetDays }) => addDays(invoice.dueDate, offsetDays) === asOf,
  ).map(({ kind }) => kind)
}
