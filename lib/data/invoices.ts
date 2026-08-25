/**
 * Invoices: planning a month, issuing it, and correcting it afterwards.
 *
 * Three things in here carry acceptance criteria directly:
 *
 *   AC4.1  issuing is idempotent. The guarantee is the database's UNIQUE
 *          (lease_id, period); this module simply asks Postgres to skip the
 *          collisions rather than pretending it checked first. A "does it
 *          already exist?" query would still lose a race between two clicks.
 *   AC4.2  the plan is computed and returned BEFORE anything is written, so
 *          missing readings and flagged units are visible while there is still
 *          a decision to make.
 *   AC5.2  anything that changes an invoice after it was issued writes an
 *          audit row: who, when, old value, new value.
 */

import { createClient } from '@/lib/supabase/server'
import { requireOperator } from '@/lib/auth'
import {
  buildInvoiceDraft,
  leaseCoversPeriod,
  type InvoiceDraft,
  type MeterPair,
} from '@/lib/domain/billing'
import { parseFlags, type MeterFlag } from '@/lib/domain/anomaly'
import { parseBreakdown, type Breakdown } from '@/lib/domain/breakdown'
import type { Period } from '@/lib/domain/period'
import { selectEffectiveTariff, toSnapshot, type TariffRow } from '@/lib/data/tariffs'
import type { Database, Json } from '@/lib/types/database'

export type InvoiceRow = Database['public']['Tables']['invoices']['Row']
export type PaymentRow = Database['public']['Tables']['payments']['Row']
export type AuditRow = Database['public']['Tables']['audit_logs']['Row']

/**
 * The audit writer.
 *
 * It lives beside invoices because invoices are what AC5.2 is about, and the
 * meter and payment modules import it from here rather than each keeping their
 * own copy — one function means one shape of audit row, which is what makes the
 * history readable later.
 *
 * The insert deliberately goes through the user's client: the policy on
 * audit_logs requires actor_id = auth.uid(), so nobody can file an entry under
 * somebody else's name, and there is no UPDATE or DELETE policy at all.
 */
export async function writeAuditLog(entry: {
  orgId: string
  actorId: string
  entity: 'invoice' | 'meter_reading' | 'payment'
  entityId: string
  action: 'create' | 'update' | 'delete'
  oldValue?: Json
  newValue?: Json
  reason?: string | null
}): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('audit_logs').insert({
    org_id: entry.orgId,
    actor_id: entry.actorId,
    entity: entry.entity,
    entity_id: entry.entityId,
    action: entry.action,
    old_value: entry.oldValue ?? null,
    new_value: entry.newValue ?? null,
    reason: entry.reason?.trim() || null,
  })

  if (error) throw new Error(error.message)
}

export interface InvoiceListItem {
  id: string
  period: string
  status: InvoiceRow['status']
  totalCents: number
  paidCents: number
  dueDate: string
  issuedAt: string | null
  unitCode: string
  propertyName: string
  tenantName: string
}

const INVOICE_JOIN =
  '*, leases!inner(id, billing_day, tenants!inner(full_name), units!inner(code, properties!inner(name)))'

type InvoiceWithJoins = InvoiceRow & {
  leases: {
    id: string
    billing_day: number
    tenants: { full_name: string }
    units: { code: string; properties: { name: string } }
  }
}

function toListItem(row: InvoiceWithJoins): InvoiceListItem {
  return {
    id: row.id,
    period: row.period,
    status: row.status,
    totalCents: row.total_cents,
    paidCents: row.paid_cents,
    dueDate: row.due_date,
    issuedAt: row.issued_at,
    unitCode: row.leases.units.code,
    propertyName: row.leases.units.properties.name,
    tenantName: row.leases.tenants.full_name,
  }
}

export async function listInvoices(filters: {
  period?: string
  status?: InvoiceRow['status']
} = {}): Promise<InvoiceListItem[]> {
  const supabase = await createClient()
  let query = supabase.from('invoices').select(INVOICE_JOIN)

  if (filters.period) query = query.eq('period', filters.period)
  if (filters.status) query = query.eq('status', filters.status)

  const { data, error } = await query
    .order('period', { ascending: false })
    .order('due_date', { ascending: true })

  if (error) throw new Error(error.message)
  return (data as InvoiceWithJoins[] | null)?.map(toListItem) ?? []
}

/** The distinct periods that already have invoices, newest first — used to populate filters. */
export async function listInvoicedPeriods(): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('invoices')
    .select('period')
    .order('period', { ascending: false })

  if (error) throw new Error(error.message)
  return [...new Set((data ?? []).map((row) => row.period))]
}

export interface InvoiceDetail {
  invoice: InvoiceRow
  breakdown: Breakdown
  unitCode: string
  propertyName: string
  tenantName: string
  payments: PaymentRow[]
  audit: AuditRow[]
}

export async function getInvoiceDetail(id: string): Promise<InvoiceDetail | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_JOIN)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  const row = data as InvoiceWithJoins

  const [{ data: payments, error: paymentsError }, { data: audit, error: auditError }] =
    await Promise.all([
      supabase.from('payments').select('*').eq('invoice_id', id).order('paid_at', { ascending: true }),
      supabase
        .from('audit_logs')
        .select('*')
        .eq('entity', 'invoice')
        .eq('entity_id', id)
        .order('created_at', { ascending: false }),
    ])

  if (paymentsError) throw new Error(paymentsError.message)
  if (auditError) throw new Error(auditError.message)

  return {
    invoice: row,
    breakdown: parseBreakdown(row.breakdown),
    unitCode: row.leases.units.code,
    propertyName: row.leases.units.properties.name,
    tenantName: row.leases.tenants.full_name,
    payments: payments ?? [],
    audit: audit ?? [],
  }
}

// ---------------------------------------------------------------------------
// AC4.2 — the pre-issue review
// ---------------------------------------------------------------------------

export interface IssuePlanLine {
  leaseId: string
  unitId: string
  unitCode: string
  propertyName: string
  tenantName: string
  /** Null when this lease was already invoiced for the period (AC4.1). */
  draft: InvoiceDraft | null
  existingInvoiceId: string | null
  /** True when no meter reading was entered for this unit and period. */
  missingReading: boolean
  flags: MeterFlag[]
}

export interface IssuePlan {
  period: Period
  tariff: TariffRow | null
  lines: IssuePlanLine[]
  /** Lines that would be created if the landlord confirms. */
  toIssue: IssuePlanLine[]
  alreadyIssued: IssuePlanLine[]
  missingReadings: IssuePlanLine[]
  flagged: IssuePlanLine[]
  totalCents: number
  /** Set when the plan cannot be executed at all. */
  blocker: string | null
}

type LeaseForBilling = {
  id: string
  unit_id: string
  rent_cents: number
  billing_day: number
  start_date: string
  end_date: string | null
  status: Database['public']['Enums']['lease_status']
  tenants: { full_name: string }
  units: { id: string; code: string; properties: { name: string } }
}

/**
 * Works out exactly what "Issue invoices for August" would do, without doing it.
 *
 * Everything a landlord needs in order to say no is in the return value: which
 * units have no reading, which readings looked wrong, which leases are already
 * billed, and what the total comes to.
 */
export async function buildIssuePlan(period: Period): Promise<IssuePlan> {
  const supabase = await createClient()

  const [leasesResult, tariffsResult, readingsResult, invoicesResult] = await Promise.all([
    supabase
      .from('leases')
      .select(
        'id, unit_id, rent_cents, billing_day, start_date, end_date, status, tenants!inner(full_name), units!inner(id, code, properties!inner(name))',
      )
      .eq('status', 'active'),
    supabase.from('tariffs').select('*'),
    supabase.from('meter_readings').select('*').eq('period', period),
    supabase.from('invoices').select('id, lease_id').eq('period', period),
  ])

  for (const result of [leasesResult, tariffsResult, readingsResult, invoicesResult]) {
    if (result.error) throw new Error(result.error.message)
  }

  const leases = ((leasesResult.data ?? []) as LeaseForBilling[]).filter((lease) =>
    leaseCoversPeriod(lease, period),
  )
  const tariff = selectEffectiveTariff((tariffsResult.data ?? []) as TariffRow[], period)
  const readings = new Map((readingsResult.data ?? []).map((row) => [row.unit_id, row]))
  const invoiced = new Map((invoicesResult.data ?? []).map((row) => [row.lease_id, row.id]))

  const lines: IssuePlanLine[] = leases
    .map((lease) => {
      const reading = readings.get(lease.unit_id) ?? null
      const existingInvoiceId = invoiced.get(lease.id) ?? null

      const electric: MeterPair | null = reading
        ? { prev: Number(reading.electric_prev), curr: Number(reading.electric_curr) }
        : null
      const water: MeterPair | null = reading
        ? { prev: Number(reading.water_prev), curr: Number(reading.water_curr) }
        : null

      const draft =
        tariff && existingInvoiceId === null
          ? buildInvoiceDraft({
              period,
              rentCents: lease.rent_cents,
              billingDay: lease.billing_day,
              tariff: toSnapshot(tariff),
              electric,
              water,
            })
          : null

      return {
        leaseId: lease.id,
        unitId: lease.unit_id,
        unitCode: lease.units.code,
        propertyName: lease.units.properties.name,
        tenantName: lease.tenants.full_name,
        draft,
        existingInvoiceId,
        missingReading: reading === null,
        flags: parseFlags(reading?.flags),
      }
    })
    .sort((a, b) =>
      a.propertyName === b.propertyName
        ? a.unitCode.localeCompare(b.unitCode, 'en', { numeric: true })
        : a.propertyName.localeCompare(b.propertyName),
    )

  const toIssue = lines.filter((line) => line.existingInvoiceId === null)
  const alreadyIssued = lines.filter((line) => line.existingInvoiceId !== null)

  return {
    period,
    tariff,
    lines,
    toIssue,
    alreadyIssued,
    missingReadings: toIssue.filter((line) => line.missingReading),
    flagged: toIssue.filter((line) => line.flags.length > 0),
    totalCents: toIssue.reduce((sum, line) => sum + (line.draft?.totalCents ?? 0), 0),
    blocker:
      tariff === null
        ? 'No rates take effect on or before the end of this period. Add a rate card before issuing.'
        : lines.length === 0
          ? 'No active lease covers this period, so there is nothing to bill.'
          : null,
  }
}

export interface IssueResult {
  created: number
  skipped: number
}

/**
 * Issues every invoice the plan says is missing.
 *
 * The insert is ON CONFLICT DO NOTHING against UNIQUE (lease_id, period), which
 * is why a double click, a retried request and two managers pressing the button
 * at the same instant all end with exactly one invoice per lease. `created`
 * counts the rows Postgres actually accepted, so the second press honestly
 * reports that it added nothing.
 *
 * Issuing IS setting issued_at (decision D10): status and total are derived by
 * the trigger, never written here.
 */
export async function issueInvoices(period: Period): Promise<IssueResult> {
  const { orgId } = await requireOperator()
  const plan = await buildIssuePlan(period)

  if (plan.blocker) throw new Error(plan.blocker)

  const payload = plan.toIssue
    .filter((line): line is IssuePlanLine & { draft: InvoiceDraft } => line.draft !== null)
    .map((line) => ({
      org_id: orgId,
      lease_id: line.leaseId,
      period,
      rent_cents: line.draft.rentCents,
      electric_cents: line.draft.electricCents,
      water_cents: line.draft.waterCents,
      service_cents: line.draft.serviceCents,
      other_cents: line.draft.otherCents,
      breakdown: line.draft.breakdown as unknown as Json,
      due_date: line.draft.dueDate,
      issued_at: new Date().toISOString(),
    }))

  if (payload.length === 0) return { created: 0, skipped: plan.alreadyIssued.length }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('invoices')
    .upsert(payload, { onConflict: 'lease_id,period', ignoreDuplicates: true })
    .select('id')

  if (error) throw new Error(error.message)

  const created = data?.length ?? 0
  return { created, skipped: payload.length - created + plan.alreadyIssued.length }
}

// ---------------------------------------------------------------------------
// AC5.2 — corrections after issuing
// ---------------------------------------------------------------------------

export interface InvoiceAdjustment {
  rentCents: number
  otherCents: number
  otherLabel: string
  dueDate: string
  reason: string
}

/**
 * Corrects an invoice that has already gone out.
 *
 * Only the two lines a landlord can legitimately restate by hand are editable:
 * rent (a concession, a prorated month) and other charges (a repair recharged
 * to the resident). The metered lines are not — they are arithmetic over the
 * meter readings, so fixing those means fixing the reading, which has its own
 * audit trail.
 *
 * The breakdown is rewritten in step with the columns, otherwise the invoice
 * would show working that no longer adds up to its own total.
 */
export async function adjustInvoice(
  id: string,
  adjustment: InvoiceAdjustment,
): Promise<InvoiceRow> {
  const { orgId, userId } = await requireOperator()
  const supabase = await createClient()

  const { data: before, error: readError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (readError) throw new Error(readError.message)
  if (!before) throw new Error('That invoice no longer exists.')

  const breakdown = parseBreakdown(before.breakdown).filter(
    (line) => line.kind !== 'rent' && line.kind !== 'other',
  )
  const rentLine: Breakdown[number] = {
    kind: 'rent',
    label: 'Rent',
    amount_cents: adjustment.rentCents,
  }
  const nextBreakdown: Breakdown = [rentLine, ...breakdown]
  if (adjustment.otherCents > 0) {
    nextBreakdown.push({
      kind: 'other',
      label: adjustment.otherLabel.trim() || 'Other charges',
      amount_cents: adjustment.otherCents,
    })
  }

  const { data: after, error: writeError } = await supabase
    .from('invoices')
    .update({
      rent_cents: adjustment.rentCents,
      other_cents: adjustment.otherCents,
      due_date: adjustment.dueDate,
      breakdown: nextBreakdown as unknown as Json,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (writeError) throw new Error(writeError.message)

  await writeAuditLog({
    orgId,
    actorId: userId,
    entity: 'invoice',
    entityId: id,
    action: 'update',
    oldValue: {
      rent_cents: before.rent_cents,
      other_cents: before.other_cents,
      due_date: before.due_date,
      total_cents: before.total_cents,
    },
    newValue: {
      rent_cents: after.rent_cents,
      other_cents: after.other_cents,
      due_date: after.due_date,
      total_cents: after.total_cents,
    },
    reason: adjustment.reason,
  })

  return after
}

/** Invoices that still owe money, newest period first — the list a payment is recorded against. */
export async function listOpenInvoices(): Promise<InvoiceListItem[]> {
  const invoices = await listInvoices()
  return invoices.filter((invoice) => invoice.issuedAt !== null && invoice.paidCents < invoice.totalCents)
}
