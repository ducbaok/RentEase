/**
 * Billing arithmetic — how a month becomes an invoice.
 *
 * Everything here is a pure function of (lease, meter readings, tariff). No IO,
 * no clock, no database: money is the part of this product that cannot be
 * wrong, so the rules that produce it have to be cheap to test exhaustively.
 *
 * Two conventions the rest of the stream depends on:
 *
 *   - Rounding happens ONCE per line, in lib/domain/money.ts::lineAmountCents,
 *     and matches Postgres round(), so a preview and a stored invoice agree to
 *     the cent.
 *   - The breakdown produced here is a SNAPSHOT (docs/sot/30-data-model.md).
 *     It carries the meter numbers and the rate actually applied, so next
 *     month's price change can never rewrite a bill someone already paid.
 */

import { lineAmountCents } from '@/lib/domain/money'
import { assertPeriod, nextPeriod, periodEndDate, type Period } from '@/lib/domain/period'
import type { Breakdown } from '@/lib/domain/breakdown'

/**
 * Display units for the metered lines.
 *
 * Open question Q5 in docs/sot/40-decisions.md asked whether the water unit
 * should be configurable per tariff. It cannot be in the MVP — `tariffs` has no
 * column for it and the schema is frozen for the batch (D7) — so US default
 * units are constants here and travel into every breakdown snapshot. Making
 * them configurable later is an additive migration plus a read of that column;
 * nothing already issued changes, because each invoice carries its own label.
 */
export const ELECTRIC_UNIT = 'kWh'
export const WATER_UNIT = 'gal'

export interface TariffSnapshot {
  electricRatePerKwh: number
  waterRatePerUnit: number
  serviceFeeCents: number
  /** 'YYYY-MM-DD' */
  effectiveFrom: string
}

/** A meter's two numbers for one period. */
export interface MeterPair {
  prev: number
  curr: number
}

export interface InvoiceDraftInput {
  period: Period
  /** Rent comes from the lease, not from the unit's default. */
  rentCents: number
  /** 1–28, from the lease. */
  billingDay: number
  tariff: TariffSnapshot
  /** Null when no reading was entered for this unit and period. */
  electric?: MeterPair | null
  water?: MeterPair | null
  otherCents?: number
  otherLabel?: string
}

export interface InvoiceDraft {
  period: Period
  /** 'YYYY-MM-DD' */
  dueDate: string
  rentCents: number
  electricCents: number
  waterCents: number
  serviceCents: number
  otherCents: number
  totalCents: number
  breakdown: Breakdown
}

/**
 * The date a period is priced at: its last day.
 *
 * A period is billed once its meters are closed, which is the end of the month,
 * so a rate that took effect part-way through the month applies to that month's
 * bill. Pricing at the first day instead would mean a rate change never affects
 * the month it was announced in, which is not what a landlord means by
 * "effective from the 15th".
 */
export function pricingDateFor(period: Period): string {
  return periodEndDate(period)
}

/**
 * The rate card in force for a period: the newest one that had already taken
 * effect by the pricing date. Returns null when the organization set no rates
 * that early — the caller must then refuse to issue rather than bill zero.
 */
export function selectTariffFor<T extends TariffSnapshot>(
  tariffs: readonly T[],
  period: Period,
): T | null {
  const asOf = pricingDateFor(period)
  let chosen: T | null = null
  for (const tariff of tariffs) {
    if (tariff.effectiveFrom > asOf) continue
    if (chosen === null || tariff.effectiveFrom > chosen.effectiveFrom) chosen = tariff
  }
  return chosen
}

/**
 * When a period's invoice falls due: the lease's billing day in the month AFTER
 * the period. August's electricity is read at the end of August and paid in
 * September; a due date inside the period would ask for money before the meters
 * were read.
 *
 * billing_day is capped at 28 by the database precisely so this date exists in
 * every month, February included.
 */
export function dueDateFor(period: Period, billingDay: number): string {
  assertPeriod(period)
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28) {
    throw new Error(`Invalid billing day ${billingDay}. Expected an integer between 1 and 28.`)
  }
  return `${nextPeriod(period)}-${String(billingDay).padStart(2, '0')}`
}

/**
 * Rounds to the two decimals the meter columns store, so 2610 - 2047.1 does not
 * arrive as 562.8999999999999 and print a consumption nobody can reconcile.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** curr - prev, exactly as the meters read — negative when a meter rolled over. */
export function consumptionOf(pair: MeterPair): number {
  return round2(pair.curr - pair.prev)
}

/**
 * What a decrease is allowed to cost: nothing.
 *
 * A meter that rolled over or was replaced reads lower than last month. The
 * true consumption is unknowable from the two numbers alone, so the resident is
 * charged zero rather than a guess. The raw readings still travel into the
 * breakdown, so the invoice shows exactly what happened instead of hiding it.
 */
export function billableConsumption(pair: MeterPair): number {
  return Math.max(0, consumptionOf(pair))
}

/**
 * Turns one lease's month into the numbers, and into the explanation of the
 * numbers.
 *
 * A metered line appears only when a reading exists: a unit with no submeter
 * bills rent alone, rather than an electricity line of $0.00 that reads like a
 * mistake.
 */
export function buildInvoiceDraft(input: InvoiceDraftInput): InvoiceDraft {
  const period = assertPeriod(input.period)
  const breakdown: Breakdown = []

  const rentCents = input.rentCents
  breakdown.push({ kind: 'rent', label: 'Rent', amount_cents: rentCents })

  let electricCents = 0
  if (input.electric) {
    const consumption = billableConsumption(input.electric)
    electricCents = lineAmountCents(consumption, input.tariff.electricRatePerKwh)
    breakdown.push({
      kind: 'electric',
      label: 'Electricity',
      prev: input.electric.prev,
      curr: input.electric.curr,
      consumption,
      unit: ELECTRIC_UNIT,
      rate: input.tariff.electricRatePerKwh,
      amount_cents: electricCents,
    })
  }

  let waterCents = 0
  if (input.water) {
    const consumption = billableConsumption(input.water)
    waterCents = lineAmountCents(consumption, input.tariff.waterRatePerUnit)
    breakdown.push({
      kind: 'water',
      label: 'Water',
      prev: input.water.prev,
      curr: input.water.curr,
      consumption,
      unit: WATER_UNIT,
      rate: input.tariff.waterRatePerUnit,
      amount_cents: waterCents,
    })
  }

  const serviceCents = input.tariff.serviceFeeCents
  if (serviceCents > 0) {
    breakdown.push({ kind: 'service', label: 'Service fee', amount_cents: serviceCents })
  }

  const otherCents = input.otherCents ?? 0
  if (otherCents > 0) {
    breakdown.push({
      kind: 'other',
      label: input.otherLabel?.trim() || 'Other charges',
      amount_cents: otherCents,
    })
  }

  return {
    period,
    dueDate: dueDateFor(period, input.billingDay),
    rentCents,
    electricCents,
    waterCents,
    serviceCents,
    otherCents,
    totalCents: rentCents + electricCents + waterCents + serviceCents + otherCents,
    breakdown,
  }
}

/**
 * Whether a lease was live at any point in a period, and therefore owes a bill
 * for it. A lease signed in September is not billed for August, and one that
 * ended in June is not billed again.
 */
export function leaseCoversPeriod(
  lease: { start_date: string; end_date: string | null; status: string },
  period: Period,
): boolean {
  if (lease.status !== 'active') return false
  const start = `${assertPeriod(period)}-01`
  const end = periodEndDate(period)
  if (lease.start_date > end) return false
  if (lease.end_date !== null && lease.end_date < start) return false
  return true
}
