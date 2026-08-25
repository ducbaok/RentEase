/**
 * Money.
 *
 * Amounts are integer cents everywhere — in the database, in these functions,
 * and in props. Floating point never touches a currency amount, because
 * 0.1 + 0.2 rounding drift on a rent roll is exactly the kind of "the software
 * got my bill wrong" the product cannot afford.
 *
 * Consumption RATES are the one exception: real utility tariffs carry four
 * decimals ($0.1425/kWh), so a rate is a decimal number and the multiplication
 * is rounded back to whole cents once, at the line level.
 */

export const CENTS_IN_UNIT = 100

/** Formats 131698 as "$1,316.98". */
export function formatCents(cents: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(cents / CENTS_IN_UNIT)
}

/**
 * Parses user input ("1,316.98", "$1316.98", "1316") into cents.
 * Returns null for anything it cannot read, so callers must decide what an
 * unreadable amount means rather than silently receiving 0.
 */
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.replace(/[\s,$]/g, '')
  if (cleaned === '' || !/^-?\d*\.?\d*$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.round(value * CENTS_IN_UNIT)
}

/**
 * Multiplies a consumption reading by a rate and rounds to whole cents.
 *
 * Rounding happens once, here, and matches Postgres `round()` on non-negative
 * numerics (half away from zero). Both consumption and rates are non-negative
 * by database constraint, so JavaScript's Math.round agrees with it exactly.
 */
export function lineAmountCents(consumption: number, ratePerUnit: number): number {
  return Math.round(consumption * ratePerUnit * CENTS_IN_UNIT)
}
