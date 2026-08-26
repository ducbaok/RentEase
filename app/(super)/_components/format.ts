/**
 * Presentation helpers for the back office.
 *
 * They live under (super)/ because stream 3B owns that path and a stream does
 * not add to components/shared mid-batch (CLAUDE.md); promote at merge if a
 * second area ever wants them. The billing screens have their own copy under
 * invoices/_components for the same reason.
 *
 * Timestamps are formatted in UTC, matching the rest of the app: a trial that
 * ends on the 9th must not read as the 8th for anyone west of Greenwich.
 */

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

/** An ISO timestamp → 'Aug 26, 2026'. */
export function formatDay(timestamp: string): string {
  return DATE_FORMAT.format(new Date(timestamp))
}

/**
 * How far away a moment is, in whole days, said in words.
 *
 * The back office is read to answer "is anyone about to fall off a trial?", so
 * "in 3 days" is the useful form and an exact timestamp is not.
 */
export function relativeDays(timestamp: string, now: Date = new Date()): string {
  const then = new Date(timestamp).getTime()
  const days = Math.round((then - now.getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`
}
