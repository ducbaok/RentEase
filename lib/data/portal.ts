/**
 * The resident portal's data access (F7).
 *
 * Everything here runs through the resident's own JWT-carrying client, so the
 * second RLS layer does the isolating: a query for "my invoices" is literally a
 * query for all invoices, and the database returns only the ones on the caller's
 * lease. There is no org id or tenant id threaded through — passing one would be
 * a way to get it wrong, and RLS would refuse it anyway (AC7.1).
 *
 * The one operator-facing function, sendPortalInvite, resolves the operator with
 * requireOperator() and reads the tenant under the operator's own org policy.
 */

import { createClient } from '@/lib/supabase/server'
import { requireOperator, requireTenant } from '@/lib/auth'
import { APP_URL } from '@/lib/env'
import { parseBreakdown, type Breakdown } from '@/lib/domain/breakdown'
import { getNotificationProvider } from '@/lib/notifications/providers'
import { buildPortalInviteEmail } from '@/lib/data/portal-emails'
import type { Database } from '@/lib/types/database'

type InvoiceRow = Database['public']['Tables']['invoices']['Row']
type PaymentRow = Database['public']['Tables']['payments']['Row']

export interface PortalInvoiceListItem {
  id: string
  period: string
  status: InvoiceRow['status']
  totalCents: number
  paidCents: number
  dueDate: string
  issuedAt: string
  unitCode: string
  propertyName: string
}

const PORTAL_INVOICE_JOIN =
  '*, leases!inner(units!inner(code, properties!inner(name)))'

type InvoiceWithUnit = InvoiceRow & {
  leases: { units: { code: string; properties: { name: string } } }
}

function toListItem(row: InvoiceWithUnit): PortalInvoiceListItem {
  return {
    id: row.id,
    period: row.period,
    status: row.status,
    totalCents: row.total_cents,
    paidCents: row.paid_cents,
    dueDate: row.due_date,
    issuedAt: row.issued_at as string,
    unitCode: row.leases.units.code,
    propertyName: row.leases.units.properties.name,
  }
}

/**
 * Every invoice the resident has, newest first. Only issued ones — a draft the
 * landlord has not released yet is not the resident's bill to see, even though
 * RLS would let them read the row.
 */
export async function getPortalInvoices(): Promise<PortalInvoiceListItem[]> {
  await requireTenant()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('invoices')
    .select(PORTAL_INVOICE_JOIN)
    .not('issued_at', 'is', null)
    .order('period', { ascending: false })

  if (error) throw new Error(error.message)
  return ((data ?? []) as InvoiceWithUnit[]).map(toListItem)
}

export interface PortalInvoiceDetail {
  invoice: InvoiceRow
  breakdown: Breakdown
  unitCode: string
  propertyName: string
  payments: PaymentRow[]
}

/**
 * One invoice with the exact arithmetic the landlord sees (AC7.2) and the
 * payments recorded against it. The breakdown is the invoice's own snapshot, so
 * a later rate change never restates a bill already paid.
 *
 * Returns null when the id is not one of the resident's own invoices — RLS
 * yields no row, and the page turns that into a 404 rather than leaking that the
 * id exists at all.
 */
export async function getPortalInvoiceDetail(id: string): Promise<PortalInvoiceDetail | null> {
  await requireTenant()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('invoices')
    .select(PORTAL_INVOICE_JOIN)
    .eq('id', id)
    .not('issued_at', 'is', null)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  const row = data as InvoiceWithUnit

  const { data: payments, error: paymentsError } = await supabase
    .from('payments')
    .select('*')
    .eq('invoice_id', id)
    .order('paid_at', { ascending: true })

  if (paymentsError) throw new Error(paymentsError.message)

  return {
    invoice: row,
    breakdown: parseBreakdown(row.breakdown),
    unitCode: row.leases.units.code,
    propertyName: row.leases.units.properties.name,
    payments: payments ?? [],
  }
}

/**
 * Sends a resident their portal invitation (operator action).
 *
 * It only reads the tenant through the operator's own org policy, so an operator
 * can never invite into someone else's organization, and it refuses to re-invite
 * an account that is already linked.
 */
export async function sendPortalInvite(tenantId: string): Promise<{ delivered: boolean }> {
  const { orgName } = await requireOperator()
  const supabase = await createClient()

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('full_name, email, portal_user_id')
    .eq('id', tenantId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!tenant) throw new Error('That resident record no longer exists.')
  if (tenant.portal_user_id) throw new Error('That resident already has a portal account.')
  if (!tenant.email) throw new Error('Add an email to this resident before inviting them.')

  const provider = getNotificationProvider()
  const result = await provider.send(
    buildPortalInviteEmail({
      to: tenant.email,
      tenantName: tenant.full_name,
      orgName,
      loginUrl: `${APP_URL}/magic-link`,
    }),
  )

  return { delivered: result.delivered }
}
