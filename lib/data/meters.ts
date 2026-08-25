/**
 * Meter readings — the one screen a landlord uses every month.
 *
 * Two rules from docs/sot/10-requirements.md are enforced here rather than in
 * the form, because a form can be bypassed:
 *
 *   AC3.1  a reading below last month's is refused unless it is explicitly
 *          confirmed. The previous number is re-read from the database on save,
 *          so a client that quietly changed `prev` to make its decrease
 *          disappear does not get away with it.
 *   AC3.3  a period entered twice is an EDIT of the same row (the database
 *          UNIQUE (unit_id, period) makes that the only possibility), and the
 *          edit writes an audit entry with the old and new numbers.
 */

import { createClient } from '@/lib/supabase/server'
import { requireOperator } from '@/lib/auth'
import { consumptionOf } from '@/lib/domain/billing'
import {
  detectFlags,
  parseFlags,
  requiresConfirmation,
  type MeterFlag,
  type UnitHistory,
} from '@/lib/domain/anomaly'
import { periodEndDate, periodStartDate, previousPeriod, type Period } from '@/lib/domain/period'
import { writeAuditLog } from '@/lib/data/invoices'
import type { Database } from '@/lib/types/database'

export type MeterReadingRow = Database['public']['Tables']['meter_readings']['Row']

export interface MeterSheetRow {
  unitId: string
  unitCode: string
  propertyName: string
  /** The reading already stored for this period, if any. */
  reading: MeterReadingRow | null
  /** Where the meters stood at the end of last period — the number the form pre-fills. */
  electricPrev: number
  waterPrev: number
  /** Consumption in earlier periods, for the spike test. */
  history: UnitHistory
  flags: MeterFlag[]
  /** False when nobody is leasing this unit for the period — it still has meters. */
  leased: boolean
}

export interface MeterSheet {
  period: Period
  rows: MeterSheetRow[]
  entered: number
  missing: number
}

type UnitWithProperty = {
  id: string
  code: string
  properties: { name: string }
}

/**
 * Everything the entry screen needs for one period, in one place.
 *
 * The whole reading history is fetched rather than just the previous period:
 * the spike test in AC3.2 compares against this unit's own average, and a
 * portfolio of 50 units over a year is a few hundred rows.
 */
export async function getMeterSheet(period: Period): Promise<MeterSheet> {
  const supabase = await createClient()

  const [unitsResult, readingsResult, leasesResult] = await Promise.all([
    supabase.from('units').select('id, code, properties!inner(name)'),
    supabase.from('meter_readings').select('*').order('period', { ascending: true }),
    supabase.from('leases').select('unit_id, start_date, end_date').eq('status', 'active'),
  ])

  for (const result of [unitsResult, readingsResult, leasesResult]) {
    if (result.error) throw new Error(result.error.message)
  }

  const units = (unitsResult.data ?? []) as UnitWithProperty[]
  const readings = readingsResult.data ?? []
  const prior = previousPeriod(period)

  const byUnit = new Map<string, MeterReadingRow[]>()
  for (const reading of readings) {
    const list = byUnit.get(reading.unit_id)
    if (list) list.push(reading)
    else byUnit.set(reading.unit_id, [reading])
  }

  const periodStart = periodStartDate(period)
  const periodEnd = periodEndDate(period)
  const leasedUnits = new Set(
    (leasesResult.data ?? [])
      .filter(
        (lease) =>
          lease.start_date <= periodEnd && (lease.end_date === null || lease.end_date >= periodStart),
      )
      .map((lease) => lease.unit_id),
  )

  const rows: MeterSheetRow[] = units
    .map((unit) => {
      const all = byUnit.get(unit.id) ?? []
      const current = all.find((row) => row.period === period) ?? null
      const previous = all.find((row) => row.period === prior) ?? null
      const earlier = all.filter((row) => row.period < period)

      return {
        unitId: unit.id,
        unitCode: unit.code,
        propertyName: unit.properties.name,
        reading: current,
        electricPrev: current ? Number(current.electric_prev) : Number(previous?.electric_curr ?? 0),
        waterPrev: current ? Number(current.water_prev) : Number(previous?.water_curr ?? 0),
        history: historyOf(earlier),
        flags: parseFlags(current?.flags),
        leased: leasedUnits.has(unit.id),
      }
    })
    .sort((a, b) =>
      a.propertyName === b.propertyName
        ? a.unitCode.localeCompare(b.unitCode, 'en', { numeric: true })
        : a.propertyName.localeCompare(b.propertyName),
    )

  return {
    period,
    rows,
    entered: rows.filter((row) => row.reading !== null).length,
    missing: rows.filter((row) => row.reading === null && row.leased).length,
  }
}

function historyOf(rows: readonly MeterReadingRow[]): UnitHistory {
  return {
    electric: rows.map((row) =>
      consumptionOf({ prev: Number(row.electric_prev), curr: Number(row.electric_curr) }),
    ),
    water: rows.map((row) =>
      consumptionOf({ prev: Number(row.water_prev), curr: Number(row.water_curr) }),
    ),
  }
}

export interface ReadingSubmission {
  unitId: string
  electricCurr: number
  waterCurr: number
  /** The person ticked "yes, the meter really reads lower" for this unit. */
  confirmed: boolean
  reason?: string
}

export interface SaveReadingsResult {
  saved: number
  updated: number
  /** Rows refused because they drop below last month and nobody confirmed it. */
  needsConfirmation: Array<{ unitId: string; flags: MeterFlag[] }>
}

/**
 * Saves a batch of readings.
 *
 * `prev` is never taken from the request. It is re-derived from the previous
 * period's stored reading (or from the row being edited), because it is the
 * number the whole bill hangs off — a client that could set it could set any
 * consumption it liked.
 */
export async function saveReadings(
  period: Period,
  submissions: readonly ReadingSubmission[],
): Promise<SaveReadingsResult> {
  const { orgId, userId } = await requireOperator()
  const supabase = await createClient()

  const sheet = await getMeterSheet(period)
  const byUnit = new Map(sheet.rows.map((row) => [row.unitId, row]))

  const needsConfirmation: SaveReadingsResult['needsConfirmation'] = []
  const inserts: Database['public']['Tables']['meter_readings']['Insert'][] = []
  const edits: Array<{ before: MeterReadingRow; flags: MeterFlag[]; submission: ReadingSubmission }> = []

  for (const submission of submissions) {
    const row = byUnit.get(submission.unitId)
    if (!row) throw new Error('That unit is not in your portfolio.')

    const candidate = {
      electric: { prev: row.electricPrev, curr: submission.electricCurr },
      water: { prev: row.waterPrev, curr: submission.waterCurr },
    }
    const flags = detectFlags(candidate, row.history)

    // AC3.1 — the refusal is here, on the server, not in the form.
    if (requiresConfirmation(flags) && !submission.confirmed) {
      needsConfirmation.push({ unitId: submission.unitId, flags })
      continue
    }

    const payload = {
      org_id: orgId,
      unit_id: submission.unitId,
      period,
      electric_prev: row.electricPrev,
      electric_curr: submission.electricCurr,
      water_prev: row.waterPrev,
      water_curr: submission.waterCurr,
      flags,
      override_reason: submission.reason?.trim() || null,
      recorded_by: userId,
    }

    inserts.push(payload)
    if (row.reading) edits.push({ before: row.reading, flags, submission })
  }

  if (inserts.length > 0) {
    const { error } = await supabase
      .from('meter_readings')
      .upsert(inserts, { onConflict: 'unit_id,period' })

    if (error) throw new Error(error.message)
  }

  // AC3.3 — re-entering a period is an edit, and an edit is recorded.
  for (const edit of edits) {
    await writeAuditLog({
      orgId,
      actorId: userId,
      entity: 'meter_reading',
      entityId: edit.before.id,
      action: 'update',
      oldValue: {
        electric_curr: Number(edit.before.electric_curr),
        water_curr: Number(edit.before.water_curr),
        flags: edit.before.flags,
      },
      newValue: {
        electric_curr: edit.submission.electricCurr,
        water_curr: edit.submission.waterCurr,
        flags: edit.flags,
      },
      reason: edit.submission.reason ?? null,
    })
  }

  return {
    saved: inserts.length - edits.length,
    updated: edits.length,
    needsConfirmation,
  }
}

/** The audit trail for one reading, shown next to it so a correction is never invisible. */
export async function listReadingAudit(readingId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('entity', 'meter_reading')
    .eq('entity_id', readingId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data ?? []
}
