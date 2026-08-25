/**
 * Billing periods.
 *
 * A period is the string 'YYYY-MM' — the same shape as the `billing_period`
 * domain in the database. Keeping it a string rather than a Date removes the
 * timezone question entirely: '2026-08' means August 2026 no matter where the
 * server, the landlord, or the resident happen to be.
 */

export type Period = string & { readonly __brand?: 'Period' }

export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function isPeriod(value: unknown): value is Period {
  return typeof value === 'string' && PERIOD_PATTERN.test(value)
}

/** Throws on malformed input so a bad period cannot reach a query. */
export function assertPeriod(value: string): Period {
  if (!isPeriod(value)) {
    throw new Error(`Invalid billing period "${value}". Expected YYYY-MM.`)
  }
  return value
}

/** The period a date falls in, read in UTC to match the database's current_date. */
export function periodOf(date: Date): Period {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function currentPeriod(now: Date = new Date()): Period {
  return periodOf(now)
}

function shift(period: Period, months: number): Period {
  assertPeriod(period)
  const [yearPart, monthPart] = period.split('-') as [string, string]
  const total = Number(yearPart) * 12 + (Number(monthPart) - 1) + months
  const year = Math.floor(total / 12)
  const month = String((total % 12) + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function previousPeriod(period: Period): Period {
  return shift(period, -1)
}

export function nextPeriod(period: Period): Period {
  return shift(period, 1)
}

/** First day of the period as 'YYYY-MM-DD'. */
export function periodStartDate(period: Period): string {
  return `${assertPeriod(period)}-01`
}

/** Last day of the period as 'YYYY-MM-DD'. */
export function periodEndDate(period: Period): string {
  const [yearPart, monthPart] = assertPeriod(period).split('-') as [string, string]
  const lastDay = new Date(Date.UTC(Number(yearPart), Number(monthPart), 0)).getUTCDate()
  return `${period}-${String(lastDay).padStart(2, '0')}`
}

/** Formats '2026-08' as 'August 2026'. */
export function formatPeriod(period: Period, locale = 'en-US'): string {
  const [yearPart, monthPart] = assertPeriod(period).split('-') as [string, string]
  const date = new Date(Date.UTC(Number(yearPart), Number(monthPart) - 1, 1))
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}
