/**
 * Properties — the root of the asset tree (F1).
 *
 * Every function here runs through the request's Supabase client, so RLS is in
 * force: a query that returns nothing is the access rules working, not a bug to
 * route around. `org_id` is still passed explicitly on writes because the
 * insert policy checks it (`with check (org_id = current_org_id())`) — a row
 * without it is refused rather than silently filed under the wrong landlord.
 */

import { createClient } from '@/lib/supabase/server'
import { occupancySummary, type OccupancySummary } from '@/lib/domain/leases'

export interface PropertySummary {
  id: string
  name: string
  address: string | null
  occupancy: OccupancySummary
}

export interface PropertyDetail {
  id: string
  name: string
  address: string | null
  createdAt: string
}

/** A write either succeeded or has something to say to the person who tried. */
export interface WriteResult {
  error: string | null
  id?: string
}

/**
 * Turns a PostgREST error into a sentence a landlord can act on.
 *
 * Anything unrecognised keeps its original message rather than being flattened
 * to "something went wrong" — an unexplained failure on a screen that handles
 * money costs more than an ugly sentence.
 */
function messageFor(error: { code?: string; message: string }): string {
  if (error.code === '42501') return 'You do not have permission to change this.'
  if (error.code === '23503') return 'That property no longer exists.'
  return error.message
}

export async function listProperties(orgId: string): Promise<PropertySummary[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('properties')
    .select('id, name, address, units(status)')
    .eq('org_id', orgId)
    .order('name')

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    address: row.address,
    occupancy: occupancySummary(row.units ?? []),
  }))
}

export async function getProperty(orgId: string, id: string): Promise<PropertyDetail | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('properties')
    .select('id, name, address, created_at')
    .eq('org_id', orgId)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return { id: data.id, name: data.name, address: data.address, createdAt: data.created_at }
}

export async function createProperty(
  orgId: string,
  input: { name: string; address: string | null },
): Promise<WriteResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('properties')
    .insert({ org_id: orgId, name: input.name, address: input.address })
    .select('id')
    .single()

  if (error) return { error: messageFor(error) }
  return { error: null, id: data.id }
}

export async function updateProperty(
  orgId: string,
  id: string,
  input: { name: string; address: string | null },
): Promise<WriteResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('properties')
    .update({ name: input.name, address: input.address })
    .eq('org_id', orgId)
    .eq('id', id)

  if (error) return { error: messageFor(error) }
  return { error: null, id }
}

/**
 * Deleting a property is refused while it still holds units.
 *
 * The database would happily do it — `units.property_id` cascades, and so do
 * the leases and invoices below it — which is exactly why the application
 * stops here. Losing a building's billing history to one mis-click is not a
 * recoverable mistake, and no landlord means it. Emptying the building first
 * is a deliberate act.
 */
export async function deleteProperty(orgId: string, id: string): Promise<WriteResult> {
  const supabase = await createClient()

  const { count, error: countError } = await supabase
    .from('units')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('property_id', id)

  if (countError) return { error: messageFor(countError) }
  if ((count ?? 0) > 0) {
    return {
      error: `This property still has ${count} unit${count === 1 ? '' : 's'}. Remove them first — deleting a property would take its units, leases and invoices with it.`,
    }
  }

  const { error } = await supabase.from('properties').delete().eq('org_id', orgId).eq('id', id)
  if (error) return { error: messageFor(error) }
  return { error: null }
}

/** Name and id only — for the property picker on the unit form. */
export async function listPropertyOptions(
  orgId: string,
): Promise<Array<{ id: string; name: string }>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('properties')
    .select('id, name')
    .eq('org_id', orgId)
    .order('name')

  if (error) throw error
  return data ?? []
}
