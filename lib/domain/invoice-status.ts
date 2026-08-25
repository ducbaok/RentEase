/**
 * Invoice status.
 *
 * MIRROR WARNING
 * ──────────────
 * This reproduces `public.compute_invoice_status` from
 * supabase/migrations/20260825000900_invariants_and_rpc.sql. The database copy
 * is authoritative — it is what actually gets stored, on every write path,
 * including ones that never touch this code. This copy exists so the UI can
 * show what a change will do before making it.
 *
 * If you change one, change the other, and re-run BOTH:
 *   pnpm test           (tests/unit/invoice-status.test.ts)
 *   pnpm test:rls       (supabase/tests/billing.test.sql — the
 *                        "compute_invoice_status" assertions)
 *
 * Dates are compared as 'YYYY-MM-DD' strings. That is not laziness: for this
 * format lexicographic order IS chronological order, and it avoids the
 * timezone off-by-one-day that Date comparison invites — an invoice must not
 * become overdue an evening early because the reader is west of UTC.
 */

export type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue'

export interface InvoiceStatusInput {
  /** Null until the invoice is issued. */
  issuedAt: string | Date | null
  totalCents: number
  paidCents: number
  /** 'YYYY-MM-DD' */
  dueDate: string
  /** 'YYYY-MM-DD'. Defaults to today in UTC, matching the database's current_date. */
  asOf?: string
}

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function computeInvoiceStatus({
  issuedAt,
  totalCents,
  paidCents,
  dueDate,
  asOf = todayUtc(),
}: InvoiceStatusInput): InvoiceStatus {
  if (issuedAt === null) return 'draft'
  if (paidCents >= totalCents) return 'paid'
  // 'overdue' deliberately outranks 'partial': someone who paid half and is
  // past due still owes money and belongs in the collections list. How much
  // they paid is not lost — paidCents carries it.
  if (asOf > dueDate) return 'overdue'
  if (paidCents > 0) return 'partial'
  return 'sent'
}

export function outstandingCents(totalCents: number, paidCents: number): number {
  return Math.max(0, totalCents - paidCents)
}

/** True for statuses a reminder may be sent about (AC6.1). */
export function isChaseable(status: InvoiceStatus): boolean {
  return status === 'sent' || status === 'partial' || status === 'overdue'
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partial: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
}
