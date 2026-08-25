/**
 * Presentation helpers shared by the billing screens.
 *
 * They live under invoices/ because stream 1B owns that path and a stream may
 * not add to components/shared mid-batch (CLAUDE.md). Promote them at merge.
 *
 * Every date the billing screens show is a 'YYYY-MM-DD' string out of a `date`
 * column, and it is formatted in UTC. Handing it to a local-timezone Date is
 * how a due date of the 5th renders as the 4th for anyone west of Greenwich.
 */

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

const DATETIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
})

/** '2026-08-05' → 'Aug 5, 2026'. */
export function formatDate(date: string): string {
  return DATE_FORMAT.format(new Date(`${date}T00:00:00Z`))
}

/** An ISO timestamp → 'Aug 5, 2026, 9:00 AM UTC'. */
export function formatDateTime(timestamp: string): string {
  return `${DATETIME_FORMAT.format(new Date(timestamp))} UTC`
}

/** Trims a float to the two decimals the meter columns actually store. */
export function formatReading(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

/**
 * A rate carries four decimals, but $0.1400 reads better as $0.14 — while
 * $0.1425 must keep all four. Trailing zeros go, never below two decimals.
 */
export function formatRate(rate: number): string {
  return `$${rate.toFixed(4).replace(/(\.\d{2}\d*?)0+$/, '$1')}`
}
