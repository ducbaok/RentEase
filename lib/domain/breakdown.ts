/**
 * Invoice breakdown — the arithmetic an invoice carries so it explains itself.
 *
 * "Every invoice explains itself. Not a bare number, but the working:
 *  electricity, 1,420 up to 2,047, that's 627 kWh at $0.14 = $87.78."
 *
 * This is a SNAPSHOT taken at issue time, stored in invoices.breakdown. It is
 * deliberately not recomputed from the current tariff: a rate change next month
 * must never silently rewrite the number a resident already paid.
 *
 * The shape is a cross-stream contract — the bulk-issue flow writes it, the
 * resident portal renders it, and the dashboard reads its totals — so it is
 * frozen here in the foundation rather than owned by any one stream.
 */

import { z } from 'zod'

export const METERED_KINDS = ['electric', 'water'] as const
export type MeteredKind = (typeof METERED_KINDS)[number]

const flatLineSchema = z.object({
  kind: z.enum(['rent', 'service', 'other']),
  label: z.string(),
  amount_cents: z.number().int(),
})

const meteredLineSchema = z.object({
  kind: z.enum(METERED_KINDS),
  label: z.string(),
  /** Meter reading at the start of the period. */
  prev: z.number(),
  /** Meter reading at the end of the period. */
  curr: z.number(),
  /** curr - prev, stored explicitly so a reader never has to trust our subtraction. */
  consumption: z.number(),
  /** Display unit, e.g. 'kWh' or 'gal'. */
  unit: z.string(),
  /** Price per unit in currency (not cents) — tariffs carry four decimals. */
  rate: z.number(),
  amount_cents: z.number().int(),
})

export const breakdownLineSchema = z.union([flatLineSchema, meteredLineSchema])
export const breakdownSchema = z.array(breakdownLineSchema)

export type FlatLine = z.infer<typeof flatLineSchema>
export type MeteredLine = z.infer<typeof meteredLineSchema>
export type BreakdownLine = z.infer<typeof breakdownLineSchema>
export type Breakdown = z.infer<typeof breakdownSchema>

export function isMeteredLine(line: BreakdownLine): line is MeteredLine {
  return (METERED_KINDS as readonly string[]).includes(line.kind)
}

/**
 * Reads a breakdown out of the database's jsonb column.
 *
 * Returns [] rather than throwing when the payload is unrecognisable: an old
 * or malformed breakdown should degrade an invoice to showing its totals, not
 * make the invoice unopenable.
 */
export function parseBreakdown(value: unknown): Breakdown {
  const result = breakdownSchema.safeParse(value)
  return result.success ? result.data : []
}

/** Sum of the lines. Should always equal the invoice's total_cents. */
export function breakdownTotalCents(breakdown: Breakdown): number {
  return breakdown.reduce((sum, line) => sum + line.amount_cents, 0)
}
