/**
 * Reading anomalies — the two things a landlord must never learn from a
 * resident's complaint.
 *
 * AC3.1: a reading BELOW last month's cannot be saved silently. Meters roll
 * over and get replaced, so this is a confirmation, not a prohibition — the
 * database deliberately has no `curr >= prev` check
 * (docs/sot/30-data-model.md). What is forbidden is saving it without anyone
 * noticing.
 *
 * AC3.2: consumption far above what this unit normally uses is flagged and
 * shown again before the invoice goes out, because a stuck meter or a leak is
 * cheaper to find in the entry screen than in a dispute.
 *
 * The flag strings match the set documented on the `flags` column in
 * supabase/migrations/20260825000400_tables_billing.sql; they are stored, so
 * renaming one means rewriting rows.
 */

import { consumptionOf, type MeterPair } from '@/lib/domain/billing'

export const METER_FLAGS = [
  'electric_decreased',
  'electric_spike',
  'water_decreased',
  'water_spike',
] as const

export type MeterFlag = (typeof METER_FLAGS)[number]

/** AC3.2's "about 3×". */
export const SPIKE_MULTIPLIER = 3

/**
 * How many past periods it takes before "normal for this unit" means anything.
 *
 * One month is not an average. Flagging against a single prior period would
 * light up every unit whose first month was a partial one — a resident who
 * moved in on the 25th uses almost nothing, and then their first full month
 * looks like a tenfold spike.
 */
export const MIN_PERIODS_FOR_SPIKE = 2

/** Consumption history for one meter of one unit, most recent first or last — order is irrelevant. */
export type ConsumptionHistory = readonly number[]

export interface ReadingCandidate {
  electric: MeterPair
  water: MeterPair
}

export interface UnitHistory {
  electric: ConsumptionHistory
  water: ConsumptionHistory
}

/**
 * The unit's usual consumption, or null when there is not enough history to
 * have a usual.
 *
 * Negative entries are dropped rather than averaged in: they are rollovers, not
 * months of negative electricity, and letting one sit in the mean would drag
 * the threshold down and flag an ordinary month as a spike.
 */
export function averageConsumption(history: ConsumptionHistory): number | null {
  const usable = history.filter((value) => Number.isFinite(value) && value >= 0)
  if (usable.length < MIN_PERIODS_FOR_SPIKE) return null
  const total = usable.reduce((sum, value) => sum + value, 0)
  const average = total / usable.length
  return average > 0 ? average : null
}

/** True when this month's consumption is more than SPIKE_MULTIPLIER × the usual. */
export function isSpike(consumption: number, history: ConsumptionHistory): boolean {
  const average = averageConsumption(history)
  if (average === null) return false
  return consumption > average * SPIKE_MULTIPLIER
}

/** True when the new number is below the old one — a rollover or a typo. */
export function isDecrease(pair: MeterPair): boolean {
  return consumptionOf(pair) < 0
}

/**
 * Every flag that applies to a candidate reading, in a stable order so the
 * stored array does not churn between saves that changed nothing.
 */
export function detectFlags(reading: ReadingCandidate, history: UnitHistory): MeterFlag[] {
  const flags: MeterFlag[] = []

  if (isDecrease(reading.electric)) flags.push('electric_decreased')
  if (isSpike(consumptionOf(reading.electric), history.electric)) flags.push('electric_spike')
  if (isDecrease(reading.water)) flags.push('water_decreased')
  if (isSpike(consumptionOf(reading.water), history.water)) flags.push('water_spike')

  return flags
}

/**
 * Whether these flags require the person entering them to confirm (AC3.1).
 *
 * Only decreases block. A spike is loud but plausible — a hot August, a new
 * baby, a filled pool — so it travels forward to the pre-issue review instead
 * of stopping data entry.
 */
export function requiresConfirmation(flags: readonly MeterFlag[]): boolean {
  return flags.some((flag) => flag === 'electric_decreased' || flag === 'water_decreased')
}

export const FLAG_LABELS: Record<MeterFlag, string> = {
  electric_decreased: 'Electric reading went down',
  electric_spike: 'Electricity use unusually high',
  water_decreased: 'Water reading went down',
  water_spike: 'Water use unusually high',
}

/** Narrowing guard for flag arrays read back out of the database. */
export function isMeterFlag(value: unknown): value is MeterFlag {
  return typeof value === 'string' && (METER_FLAGS as readonly string[]).includes(value)
}

export function parseFlags(value: unknown): MeterFlag[] {
  return Array.isArray(value) ? value.filter(isMeterFlag) : []
}
