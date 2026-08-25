import Link from 'next/link'
import type { Route } from 'next'
import { Button } from '@/components/ui/button'
import { formatPeriod, nextPeriod, previousPeriod, type Period } from '@/lib/domain/period'

/**
 * Month stepper.
 *
 * Plain links rather than a dropdown: the period is in the URL, so a landlord
 * can bookmark last month's sheet, and the back button does what they expect.
 */
export function PeriodNav({ period, basePath }: { period: Period; basePath: string }) {
  const back = `${basePath}?period=${previousPeriod(period)}` as Route
  const forward = `${basePath}?period=${nextPeriod(period)}` as Route

  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <Link href={back} aria-label="Previous month">
          ←
        </Link>
      </Button>
      <span className="min-w-40 text-center text-sm font-medium">{formatPeriod(period)}</span>
      <Button asChild variant="outline" size="sm">
        <Link href={forward} aria-label="Next month">
          →
        </Link>
      </Button>
    </div>
  )
}
