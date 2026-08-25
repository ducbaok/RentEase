/**
 * Rate cards.
 *
 * A tariff is time-versioned rather than editable-in-place: billing a period
 * picks the newest card that had taken effect by the end of that period
 * (lib/domain/billing.ts::selectTariffFor). Raising the electricity rate is
 * therefore a new row, and every invoice already issued keeps the rate it was
 * priced with, because that rate is snapshotted in its breakdown.
 *
 * Every query here runs through the user's own Supabase client, so RLS decides
 * which rows exist. There is no org_id filter in these functions and there must
 * not be one: a filter in application code that looks like the security rule
 * invites someone to trust it.
 */

import { createClient } from '@/lib/supabase/server'
import { requireOperator } from '@/lib/auth'
import { selectTariffFor, type TariffSnapshot } from '@/lib/domain/billing'
import type { Period } from '@/lib/domain/period'
import type { Database } from '@/lib/types/database'

export type TariffRow = Database['public']['Tables']['tariffs']['Row']

export interface TariffInput {
  electricRatePerKwh: number
  waterRatePerUnit: number
  serviceFeeCents: number
  /** 'YYYY-MM-DD' */
  effectiveFrom: string
}

/** Newest first, which is the order a landlord reads a rate history in. */
export async function listTariffs(): Promise<TariffRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tariffs')
    .select('*')
    .order('effective_from', { ascending: false })

  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getTariff(id: string): Promise<TariffRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('tariffs').select('*').eq('id', id).maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

export function toSnapshot(row: TariffRow): TariffSnapshot {
  return {
    electricRatePerKwh: Number(row.electric_rate_per_kwh),
    waterRatePerUnit: Number(row.water_rate_per_unit),
    serviceFeeCents: row.service_fee_cents,
    effectiveFrom: row.effective_from,
  }
}

/** The card that prices a given period, out of rows already fetched. */
export function selectEffectiveTariff(rows: readonly TariffRow[], period: Period): TariffRow | null {
  const candidates = rows.map((row) => ({ row, ...toSnapshot(row) }))
  return selectTariffFor(candidates, period)?.row ?? null
}

/** The card that prices a given period, or null when rates were never set that early. */
export async function getEffectiveTariff(period: Period): Promise<TariffRow | null> {
  return selectEffectiveTariff(await listTariffs(), period)
}

export async function createTariff(input: TariffInput): Promise<TariffRow> {
  const { orgId } = await requireOperator()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('tariffs')
    .insert({
      org_id: orgId,
      electric_rate_per_kwh: input.electricRatePerKwh,
      water_rate_per_unit: input.waterRatePerUnit,
      service_fee_cents: input.serviceFeeCents,
      effective_from: input.effectiveFrom,
    })
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function updateTariff(id: string, input: TariffInput): Promise<TariffRow> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('tariffs')
    .update({
      electric_rate_per_kwh: input.electricRatePerKwh,
      water_rate_per_unit: input.waterRatePerUnit,
      service_fee_cents: input.serviceFeeCents,
      effective_from: input.effectiveFrom,
    })
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function deleteTariff(id: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.from('tariffs').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
