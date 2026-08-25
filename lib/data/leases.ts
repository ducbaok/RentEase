/**
 * Leases (F2) — who rents which unit, and until when.
 *
 * The two rules this module serves are both enforced below it:
 *
 *   AC2.1  the EXCLUDE constraint on public.leases refuses a second active
 *          lease overlapping the same unit. `createLease` asks the domain
 *          module first only so the screen can name the other resident; if
 *          that check were removed the database would still refuse the write.
 *   AC2.2  `public.sync_unit_status_for()` moves the unit between vacant and
 *          occupied on every lease write. Nothing here sets `units.status`.
 */

import { createClient } from '@/lib/supabase/server'
import {
  findConflictingLease,
  formatTerm,
  occupiesOn,
  todayIso,
  type IsoDate,
  type LeaseStatus,
} from '@/lib/domain/leases'

export interface LeaseListRow {
  id: string
  status: LeaseStatus
  startDate: string
  endDate: string | null
  rentCents: number
  depositCents: number
  billingDay: number
  unitId: string
  unitLabel: string
  tenantId: string
  tenantName: string
  /** True when this lease is what makes its unit occupied today. */
  occupiesToday: boolean
}

export interface WriteResult {
  error: string | null
  id?: string
}

export interface LeaseInput {
  unitId: string
  tenantId: string
  startDate: string
  endDate: string | null
  rentCents: number
  depositCents: number
  billingDay: number
}

function messageFor(error: { code?: string; message: string }): string {
  if (error.code === '23P01') {
    // AC2.1. Reached when two managers save at the same instant and the
    // pre-check above both of them saw a free unit.
    return 'That unit already has an active lease covering those dates. End the current lease first.'
  }
  if (error.code === '23514') {
    return 'Check the dates and the billing day — a lease cannot end before it starts, and the billing day must be between 1 and 28.'
  }
  if (error.code === '23503') return 'That unit or resident no longer exists.'
  if (error.code === '42501') return 'You do not have permission to change this.'
  return error.message
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

const LEASE_SELECT =
  'id, status, start_date, end_date, rent_cents, deposit_cents, billing_day, unit_id, tenant_id, ' +
  'units(code, properties(name)), tenants(full_name)'

interface RawUnitRef {
  code: string
  properties: { name: string } | { name: string }[] | null
}

interface RawLease {
  id: string
  status: LeaseStatus
  start_date: string
  end_date: string | null
  rent_cents: number
  deposit_cents: number
  billing_day: number
  unit_id: string
  tenant_id: string
  units: RawUnitRef | RawUnitRef[] | null
  tenants: { full_name: string } | { full_name: string }[] | null
}

function toRow(row: RawLease, asOf: IsoDate): LeaseListRow {
  const unit = one(row.units)
  const property = unit ? one(unit.properties) : null

  return {
    id: row.id,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    rentCents: row.rent_cents,
    depositCents: row.deposit_cents,
    billingDay: row.billing_day,
    unitId: row.unit_id,
    unitLabel: unit ? (property ? `${property.name} · ${unit.code}` : unit.code) : 'Unknown unit',
    tenantId: row.tenant_id,
    tenantName: one(row.tenants)?.full_name ?? 'Unknown resident',
    occupiesToday: occupiesOn(
      { status: row.status, startDate: row.start_date, endDate: row.end_date },
      asOf,
    ),
  }
}

export async function listLeases(
  orgId: string,
  options: { status?: LeaseStatus } = {},
): Promise<LeaseListRow[]> {
  const supabase = await createClient()
  let query = supabase.from('leases').select(LEASE_SELECT).eq('org_id', orgId)
  if (options.status) query = query.eq('status', options.status)

  const { data, error } = await query.order('start_date', { ascending: false })
  if (error) throw error

  const asOf = todayIso()
  return ((data as unknown as RawLease[] | null) ?? []).map((row) => toRow(row, asOf))
}

export async function getLease(orgId: string, id: string): Promise<LeaseListRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('leases')
    .select(LEASE_SELECT)
    .eq('org_id', orgId)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return toRow(data as unknown as RawLease, todayIso())
}

/** Every lease on one unit — what the overlap pre-check reads. */
export async function listLeasesForUnit(
  orgId: string,
  unitId: string,
): Promise<LeaseListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('leases')
    .select(LEASE_SELECT)
    .eq('org_id', orgId)
    .eq('unit_id', unitId)
    .order('start_date', { ascending: false })

  if (error) throw error
  const asOf = todayIso()
  return ((data as unknown as RawLease[] | null) ?? []).map((row) => toRow(row, asOf))
}

/**
 * Names the active lease a proposed term would collide with, in words.
 *
 * This is a courtesy, not a guard: between this read and the insert another
 * manager can save the same unit, and then the EXCLUDE constraint is what
 * actually stops the double booking. Both paths end at the same sentence.
 */
async function describeConflict(
  orgId: string,
  input: Pick<LeaseInput, 'unitId' | 'startDate' | 'endDate'>,
  excludeLeaseId?: string,
): Promise<string | null> {
  const existing = await listLeasesForUnit(orgId, input.unitId)
  const clash = findConflictingLease(
    existing.map((lease) => ({
      id: lease.id,
      status: lease.status,
      startDate: lease.startDate,
      endDate: lease.endDate,
      tenantName: lease.tenantName,
    })),
    { startDate: input.startDate, endDate: input.endDate },
    excludeLeaseId,
  )

  if (!clash) return null
  return `${clash.tenantName} already holds this unit for ${formatTerm(clash)}. End that lease before starting a new one.`
}

export async function createLease(orgId: string, input: LeaseInput): Promise<WriteResult> {
  const conflict = await describeConflict(orgId, input)
  if (conflict) return { error: conflict }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('leases')
    .insert({
      org_id: orgId,
      unit_id: input.unitId,
      tenant_id: input.tenantId,
      start_date: input.startDate,
      end_date: input.endDate,
      rent_cents: input.rentCents,
      deposit_cents: input.depositCents,
      billing_day: input.billingDay,
      status: 'active',
    })
    .select('id')
    .single()

  if (error) return { error: messageFor(error) }
  return { error: null, id: data.id }
}

export async function updateLease(
  orgId: string,
  id: string,
  input: LeaseInput,
): Promise<WriteResult> {
  const conflict = await describeConflict(orgId, input, id)
  if (conflict) return { error: conflict }

  const supabase = await createClient()
  const { error } = await supabase
    .from('leases')
    .update({
      unit_id: input.unitId,
      tenant_id: input.tenantId,
      start_date: input.startDate,
      end_date: input.endDate,
      rent_cents: input.rentCents,
      deposit_cents: input.depositCents,
      billing_day: input.billingDay,
    })
    .eq('org_id', orgId)
    .eq('id', id)

  if (error) return { error: messageFor(error) }
  return { error: null, id }
}

/**
 * Ends a lease (AC2.2).
 *
 * Two things happen in one write, and both matter: the status becomes 'ended',
 * which drops the row out of the EXCLUDE constraint so the unit can be re-let,
 * and the end date is recorded so the history says when the resident actually
 * left. The unit going back to vacant is not done here — the lease trigger
 * does it, which is why it also happens for a lease ended by direct SQL.
 */
export async function endLease(
  orgId: string,
  id: string,
  endDate: IsoDate,
): Promise<WriteResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('leases')
    .update({ status: 'ended', end_date: endDate })
    .eq('org_id', orgId)
    .eq('id', id)
    .eq('status', 'active')

  if (error) return { error: messageFor(error) }
  return { error: null, id }
}

/**
 * Deletes a lease outright.
 *
 * Refused once invoices hang off it: the FK cascades, so removing the lease
 * would erase the bills and the payments against them. Ending a lease is the
 * normal action; deleting is for one entered by mistake.
 */
export async function deleteLease(orgId: string, id: string): Promise<WriteResult> {
  const supabase = await createClient()

  const { count, error: countError } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('lease_id', id)

  if (countError) return { error: messageFor(countError) }
  if ((count ?? 0) > 0) {
    return {
      error: `This lease already has ${count} invoice${count === 1 ? '' : 's'}. End it instead — deleting would erase the billing history.`,
    }
  }

  const { error } = await supabase.from('leases').delete().eq('org_id', orgId).eq('id', id)
  if (error) return { error: messageFor(error) }
  return { error: null }
}
