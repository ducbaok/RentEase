/**
 * The shapes AI answers must have.
 *
 * These zod schemas are the ONLY description of those shapes. The JSON Schema
 * the Messages API is given is generated from them by `outputFormatFor()` in
 * lib/ai/provider.ts. Do not write a JSON Schema by hand next to one of these:
 * that is two sources of truth for one concept, which is the trap that produced
 * B3-6, and the two would drift the first time a field changed.
 */

import { z } from 'zod'

/**
 * The largest reading a suggestion is allowed to carry.
 *
 * This is the ENTRY SCREEN's ceiling, not the column's. The column holds far
 * more — `meter_readings.electric_curr` and `water_curr` are `numeric(12, 2)`
 * with a `>= 0` check (supabase/migrations/20260825000400_tables_billing.sql)
 * — but app/(dashboard)/meters/actions.ts refuses anything above this when the
 * form is submitted, and it refuses it with "Some readings are not numbers",
 * which is both untrue and unactionable.
 *
 * Bounding a suggestion by the column rather than by the form is how a number
 * gets offered that cannot be saved: it appears in the box, the operator
 * presses Save, and the screen tells them they typed something that is not a
 * number. Offering only what the save path will take is what keeps the empty
 * box the honest fallback AC9.3 intends it to be.
 *
 * A model that reads nine digits off a five-digit dial has misread it either
 * way, so nothing legible is lost by the lower bound.
 *
 * tests/unit/ai/ceilings.test.ts holds the two ends together by running a
 * suggestion at exactly this value through saveReadingsAction, and one just
 * above it, so the two numbers cannot drift apart again.
 */
export const MAX_METER_READING = 99_999_999

/**
 * One dial. `null` is a valid answer and the RIGHT answer when the digits are
 * not legible (AC9.3) — a wrong number looks exactly like a right one, and the
 * empty box falls back to the behaviour of typing by hand.
 *
 * z.number() rejects NaN and Infinity in zod 4, so "unreadable" cannot arrive
 * disguised as a number.
 */
const meterValue = z.number().min(0).max(MAX_METER_READING).nullable()

/**
 * What reading a meter photo produces (F9).
 *
 * `strictObject`: an answer carrying keys nobody asked for is a broken answer,
 * not an answer with extras. Structured output makes that unlikely; refusing it
 * costs one word and closes the case where a model was talked into adding a
 * field.
 */
export const meterReadingSchema = z.strictObject({
  electric: meterValue,
  water: meterValue,
  confidence: z.enum(['high', 'low']),
})

export type MeterReadingSuggestion = z.infer<typeof meterReadingSchema>
