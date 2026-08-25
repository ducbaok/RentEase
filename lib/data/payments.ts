/**
 * Payments received.
 *
 * AC5.1 is not implemented here, and that is the point: paid_cents and the
 * invoice status are recomputed by a database trigger from the sum of the
 * payment rows (migration 0900). This module inserts and deletes rows; what
 * they mean for the invoice is decided in one place, on every write path,
 * including ones that never come through this file.
 *
 * There is no "edit a payment": a mistaken amount is deleted and re-entered, so
 * that "how much came in" is always the sum of rows that each really happened.
 * The deletion is what the audit log records (AC5.2).
 */

import { createClient } from '@/lib/supabase/server'
import { requireOperator } from '@/lib/auth'
import { writeAuditLog, type PaymentRow } from '@/lib/data/invoices'
import type { Database } from '@/lib/types/database'

export type PaymentMethod = Database['public']['Enums']['payment_method']

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
}

export interface PaymentListItem {
  id: string
  invoiceId: string
  amountCents: number
  paidAt: string
  method: PaymentMethod
  note: string | null
  period: string
  unitCode: string
  tenantName: string
  invoiceStatus: Database['public']['Enums']['invoice_status']
}

type PaymentWithJoins = PaymentRow & {
  invoices: {
    period: string
    status: Database['public']['Enums']['invoice_status']
    leases: { tenants: { full_name: string }; units: { code: string } }
  }
}

export async function listPayments(): Promise<PaymentListItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('payments')
    .select(
      '*, invoices!inner(period, status, leases!inner(tenants!inner(full_name), units!inner(code)))',
    )
    .order('paid_at', { ascending: false })

  if (error) throw new Error(error.message)

  return ((data ?? []) as PaymentWithJoins[]).map((row) => ({
    id: row.id,
    invoiceId: row.invoice_id,
    amountCents: row.amount_cents,
    paidAt: row.paid_at,
    method: row.method,
    note: row.note,
    period: row.invoices.period,
    unitCode: row.invoices.leases.units.code,
    tenantName: row.invoices.leases.tenants.full_name,
    invoiceStatus: row.invoices.status,
  }))
}

export interface RecordPaymentInput {
  invoiceId: string
  amountCents: number
  method: PaymentMethod
  /** 'YYYY-MM-DD'; the day the money arrived, which is not always today. */
  paidOn: string
  note?: string
}

/**
 * Records money received against an invoice.
 *
 * Overpaying is allowed on purpose — a resident who rounds up, or pays a
 * deposit along with the rent, should not be met with a validation error. The
 * status rule handles it: paid_cents >= total_cents is `paid`, and the excess
 * stays visible in paid_cents rather than being silently dropped.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<PaymentRow> {
  const { orgId, userId } = await requireOperator()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('payments')
    .insert({
      org_id: orgId,
      invoice_id: input.invoiceId,
      amount_cents: input.amountCents,
      method: input.method,
      paid_at: new Date(`${input.paidOn}T12:00:00Z`).toISOString(),
      note: input.note?.trim() || null,
      recorded_by: userId,
    })
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data
}

/**
 * Removes a payment that should not have been recorded.
 *
 * The invoice's paid_cents is recomputed from scratch by the trigger, so the
 * balance cannot keep a ghost of the deleted amount. The row itself is gone,
 * which is exactly why the audit entry copies its contents first.
 */
export async function deletePayment(id: string, reason: string): Promise<void> {
  const { orgId, userId } = await requireOperator()
  const supabase = await createClient()

  const { data: before, error: readError } = await supabase
    .from('payments')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (readError) throw new Error(readError.message)
  if (!before) throw new Error('That payment no longer exists.')

  const { error: deleteError } = await supabase.from('payments').delete().eq('id', id)
  if (deleteError) throw new Error(deleteError.message)

  await writeAuditLog({
    orgId,
    actorId: userId,
    entity: 'payment',
    entityId: id,
    action: 'delete',
    oldValue: {
      invoice_id: before.invoice_id,
      amount_cents: before.amount_cents,
      method: before.method,
      paid_at: before.paid_at,
      note: before.note,
    },
    newValue: null,
    reason,
  })
}
