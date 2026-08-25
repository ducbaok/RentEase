/**
 * Units — the thing that is actually rented (F1).
 *
 * `units.status` is not a field the application maintains. It is written by
 * `public.sync_unit_status_for()` whenever a lease changes (AC2.2), so this
 * module reads it and never fights it: the only place a status is written from
 * here is a unit that has no lease at all, where nothing else can speak for it.
 */

import { createClient } from '@/lib/supabase/server'
import {
  occupancySummary,
  occupiesOn,
  todayIso,
  type IsoDate,
  type OccupancySummary,
  type UnitStatus,
} from '@/lib/domain/leases'

export interface UnitListRow {
  id: string
  code: string
  area: number | null
  baseRentCents: number
  status: UnitStatus
  propertyId: string
  propertyName: string
  /** The lease putting someone in the unit today, if there is one. */
  currentLease: { id: string; tenantId: string; tenantName: string; endDate: string | null } | null
}

export interface UnitDetail extends UnitListRow {
  createdAt: string
  leases: Array<{
    id: string
    status: 'active' | 'ended'
    startDate: string
    endDate: string | null
    rentCents: number
    tenantId: string
    tenantName: string
    occupiesToday: boolean
  }>
}

export interface WriteResult {
  error: string | null
  id?: string
}

function messageFor(error: { code?: string; message: string }): string {
  if (error.code === '23505') {
    // AC1.2 — the unique index on (property_id, code) is the real rule; this
    // only translates it.
    return 'A unit with that code already exists in this property. Unit codes are unique per building.'
  }
  if (error.code === '42501') return 'You do not have permission to change this.'
  if (error.code === '23503') return 'That property no longer exists.'
  return error.message
}

/**
 * PostgREST hands back embedded rows as arrays for composite foreign keys.
 * There is exactly one parent, so take the first and be explicit about it
 * rather than sprinkling `[0]` through the mapping code.
 */
function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

const UNIT_SELECT =
  'id, code, area, base_rent_cents, status, property_id, created_at, ' +
  'properties(name), ' +
  'leases(id, status, start_date, end_date, rent_cents, tenant_id, tenants(full_name))'

interface RawUnit {
  id: string
  code: string
  area: number | null
  base_rent_cents: number
  status: UnitStatus
  property_id: string
  created_at: string
  properties: { name: string } | { name: string }[] | null
  leases: Array<{
    id: string
    status: 'active' | 'ended'
    start_date: string
    end_date: string | null
    rent_cents: number
    tenant_id: string
    tenants: { full_name: string } | { full_name: string }[] | null
  }> | null
}

function toDetail(row: RawUnit, asOf: IsoDate): UnitDetail {
  const leases = (row.leases ?? [])
    .map((lease) => ({
      id: lease.id,
      status: lease.status,
      startDate: lease.start_date,
      endDate: lease.end_date,
      rentCents: lease.rent_cents,
      tenantId: lease.tenant_id,
      tenantName: one(lease.tenants)?.full_name ?? 'Unknown resident',
      occupiesToday: occupiesOn(
        { status: lease.status, startDate: lease.start_date, endDate: lease.end_date },
        asOf,
      ),
    }))
    // Newest first: the lease a landlord wants is almost always the current one.
    .sort((a, b) => b.startDate.localeCompare(a.startDate))

  const current = leases.find((lease) => lease.occupiesToday) ?? null

  return {
    id: row.id,
    code: row.code,
    area: row.area,
    baseRentCents: row.base_rent_cents,
    status: row.status,
    propertyId: row.property_id,
    propertyName: one(row.properties)?.name ?? 'Unknown property',
    createdAt: row.created_at,
    currentLease: current
      ? {
          id: current.id,
          tenantId: current.tenantId,
          tenantName: current.tenantName,
          endDate: current.endDate,
        }
      : null,
    leases,
  }
}

export async function listUnits(
  orgId: string,
  options: { propertyId?: string } = {},
): Promise<UnitListRow[]> {
  const supabase = await createClient()
  let query = supabase.from('units').select(UNIT_SELECT).eq('org_id', orgId)
  if (options.propertyId) query = query.eq('property_id', options.propertyId)

  const { data, error } = await query
  if (error) throw error

  const asOf = todayIso()
  return (((data as unknown as RawUnit[] | null) ?? [])
    .map((row) => toDetail(row, asOf))
    // Property, then unit code read the way a human reads them: 2 before 10.
    .sort(
      (a, b) =>
        a.propertyName.localeCompare(b.propertyName) ||
        a.code.localeCompare(b.code, undefined, { numeric: true }),
    ))
}

export async function getUnit(orgId: string, id: string): Promise<UnitDetail | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('units')
    .select(UNIT_SELECT)
    .eq('org_id', orgId)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return toDetail(data as unknown as RawUnit, todayIso())
}

/**
 * AC1.1 — occupancy across the whole portfolio.
 *
 * Derived on every read from the unit rows themselves, so the moment a lease
 * (or a manual change on an unleased unit) moves a unit, the next render of
 * any screen showing this number is already right. Stream 2B reads the same
 * function for the dashboard card, so the two can never disagree.
 */
export async function getOccupancySummary(orgId: string): Promise<OccupancySummary> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('units').select('status').eq('org_id', orgId)
  if (error) throw error
  return occupancySummary(data ?? [])
}

export async function createUnit(
  orgId: string,
  input: {
    propertyId: string
    code: string
    area: number | null
    baseRentCents: number
    status: UnitStatus
  },
): Promise<WriteResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('units')
    .insert({
      org_id: orgId,
      property_id: input.propertyId,
      code: input.code,
      area: input.area,
      base_rent_cents: input.baseRentCents,
      status: input.status,
    })
    .select('id')
    .single()

  if (error) return { error: messageFor(error) }
  return { error: null, id: data.id }
}

/**
 * Updates a unit.
 *
 * `status` is only written when the caller passes one, and the action layer
 * only passes one for a unit with no lease covering today. For every other
 * unit the lease trigger owns the column and a write from here would be
 * overwritten the next time any lease moved — a lie with a short shelf life.
 */
export async function updateUnit(
  orgId: string,
  id: string,
  input: {
    propertyId: string
    code: string
    area: number | null
    baseRentCents: number
    status?: UnitStatus
  },
): Promise<WriteResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('units')
    .update({
      property_id: input.propertyId,
      code: input.code,
      area: input.area,
      base_rent_cents: input.baseRentCents,
      ...(input.status ? { status: input.status } : {}),
    })
    .eq('org_id', orgId)
    .eq('id', id)

  if (error) return { error: messageFor(error) }
  return { error: null, id }
}

/**
 * Refused while any lease references the unit — deleting it would cascade
 * through leases to invoices and payments, quietly erasing what a resident
 * actually paid.
 */
export async function deleteUnit(orgId: string, id: string): Promise<WriteResult> {
  const supabase = await createClient()

  const { count, error: countError } = await supabase
    .from('leases')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('unit_id', id)

  if (countError) return { error: messageFor(countError) }
  if ((count ?? 0) > 0) {
    return {
      error: `This unit has ${count} lease${count === 1 ? '' : 's'} on record. Deleting it would take their invoices and payments too, so it is refused.`,
    }
  }

  const { error } = await supabase.from('units').delete().eq('org_id', orgId).eq('id', id)
  if (error) return { error: messageFor(error) }
  return { error: null }
}

/** Units for the lease form's picker, labelled with the building they are in. */
export async function listUnitOptions(orgId: string): Promise<
  Array<{ id: string; label: string; status: UnitStatus; baseRentCents: number }>
> {
  const units = await listUnits(orgId)
  return units.map((unit) => ({
    id: unit.id,
    label: `${unit.propertyName} · ${unit.code}`,
    status: unit.status,
    baseRentCents: unit.baseRentCents,
  }))
}
