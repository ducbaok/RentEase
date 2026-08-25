/**
 * Residents (F1/F2).
 *
 * A resident exists here long before they ever open the portal — `portal_user_id`
 * stays NULL until stream 2A sends the magic-link invite — because billing has
 * to work for someone who never signs in at all. Nothing in this module touches
 * that column.
 */

import { createClient } from '@/lib/supabase/server'
import { occupiesOn, todayIso, type IsoDate } from '@/lib/domain/leases'

export interface TenantListRow {
  id: string
  fullName: string
  email: string | null
  phone: string | null
  hasPortalAccount: boolean
  /** Where they live today, if a lease currently covers them. */
  currentUnit: { unitId: string; label: string } | null
  leaseCount: number
}

export interface TenantDetail extends TenantListRow {
  createdAt: string
  leases: Array<{
    id: string
    status: 'active' | 'ended'
    startDate: string
    endDate: string | null
    rentCents: number
    unitId: string
    unitLabel: string
    occupiesToday: boolean
  }>
}

export interface WriteResult {
  error: string | null
  id?: string
}

function messageFor(error: { code?: string; message: string }): string {
  if (error.code === '23503') {
    return 'This resident is still named on a lease. End and remove the lease first.'
  }
  if (error.code === '42501') return 'You do not have permission to change this.'
  return error.message
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value
}

const TENANT_SELECT =
  'id, full_name, email, phone, portal_user_id, created_at, ' +
  'leases(id, status, start_date, end_date, rent_cents, unit_id, units(code, properties(name)))'

interface RawUnitRef {
  code: string
  properties: { name: string } | { name: string }[] | null
}

interface RawTenant {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  portal_user_id: string | null
  created_at: string
  leases: Array<{
    id: string
    status: 'active' | 'ended'
    start_date: string
    end_date: string | null
    rent_cents: number
    unit_id: string
    units: RawUnitRef | RawUnitRef[] | null
  }> | null
}

function unitLabel(units: RawUnitRef | RawUnitRef[] | null): string {
  const unit = one(units)
  if (!unit) return 'Unknown unit'
  const property = one(unit.properties)
  return property ? `${property.name} · ${unit.code}` : unit.code
}

function toDetail(row: RawTenant, asOf: IsoDate): TenantDetail {
  const leases = (row.leases ?? [])
    .map((lease) => ({
      id: lease.id,
      status: lease.status,
      startDate: lease.start_date,
      endDate: lease.end_date,
      rentCents: lease.rent_cents,
      unitId: lease.unit_id,
      unitLabel: unitLabel(lease.units),
      occupiesToday: occupiesOn(
        { status: lease.status, startDate: lease.start_date, endDate: lease.end_date },
        asOf,
      ),
    }))
    .sort((a, b) => b.startDate.localeCompare(a.startDate))

  const current = leases.find((lease) => lease.occupiesToday) ?? null

  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    hasPortalAccount: row.portal_user_id !== null,
    currentUnit: current ? { unitId: current.unitId, label: current.unitLabel } : null,
    leaseCount: leases.length,
    createdAt: row.created_at,
    leases,
  }
}

export async function listTenants(orgId: string): Promise<TenantListRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tenants')
    .select(TENANT_SELECT)
    .eq('org_id', orgId)
    .order('full_name')

  if (error) throw error
  const asOf = todayIso()
  return ((data as unknown as RawTenant[] | null) ?? []).map((row) => toDetail(row, asOf))
}

export async function getTenant(orgId: string, id: string): Promise<TenantDetail | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tenants')
    .select(TENANT_SELECT)
    .eq('org_id', orgId)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return toDetail(data as unknown as RawTenant, todayIso())
}

export async function createTenant(
  orgId: string,
  input: { fullName: string; email: string | null; phone: string | null },
): Promise<WriteResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tenants')
    .insert({
      org_id: orgId,
      full_name: input.fullName,
      email: input.email,
      phone: input.phone,
    })
    .select('id')
    .single()

  if (error) return { error: messageFor(error) }
  return { error: null, id: data.id }
}

export async function updateTenant(
  orgId: string,
  id: string,
  input: { fullName: string; email: string | null; phone: string | null },
): Promise<WriteResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('tenants')
    .update({ full_name: input.fullName, email: input.email, phone: input.phone })
    .eq('org_id', orgId)
    .eq('id', id)

  if (error) return { error: messageFor(error) }
  return { error: null, id }
}

/**
 * The database already refuses this while a lease names the resident — the FK
 * from `leases.tenant_id` is ON DELETE RESTRICT. The check below only gets
 * there first so the message names the lease rather than the constraint.
 */
export async function deleteTenant(orgId: string, id: string): Promise<WriteResult> {
  const supabase = await createClient()

  const { count, error: countError } = await supabase
    .from('leases')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('tenant_id', id)

  if (countError) return { error: messageFor(countError) }
  if ((count ?? 0) > 0) {
    return {
      error: `This resident is named on ${count} lease${count === 1 ? '' : 's'}. Remove the lease first — their invoices hang off it.`,
    }
  }

  const { error } = await supabase.from('tenants').delete().eq('org_id', orgId).eq('id', id)
  if (error) return { error: messageFor(error) }
  return { error: null }
}

/** Residents for the lease form's picker. */
export async function listTenantOptions(
  orgId: string,
): Promise<Array<{ id: string; label: string }>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tenants')
    .select('id, full_name, email')
    .eq('org_id', orgId)
    .order('full_name')

  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.email ? `${row.full_name} (${row.email})` : row.full_name,
  }))
}
