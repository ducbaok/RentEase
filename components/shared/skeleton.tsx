import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Loading placeholders.
 *
 * Every screen in RentEase is a server component that waits on the database, so
 * between clicking "Invoices" and seeing invoices there is a gap. Without a
 * placeholder that gap renders as the previous page frozen mid-click, which
 * reads as "nothing happened" and gets clicked again — the one thing a billing
 * app should not encourage.
 *
 * The shapes deliberately match the real content's layout, so the page does not
 * jump when the data lands. `aria-hidden` on the bars keeps a screen reader out
 * of a field of meaningless boxes; the container carries the live message
 * instead.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}

/** Wraps a set of skeletons so assistive technology hears one useful sentence. */
export function SkeletonRegion({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

/** The page title and subtitle, at the same size PageHeader renders them. */
export function SkeletonPageHeader() {
  return (
    <div className="mb-6 space-y-2">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-72" />
    </div>
  )
}

/** A table of `rows` lines inside a card, matching the list screens. */
export function SkeletonTable({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <div className="flex gap-4 border-b border-border pb-3">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center gap-4 py-3.5">
            {Array.from({ length: columns }, (_, column) => (
              <Skeleton key={column} className={cn('h-4 flex-1', column === 0 && 'max-w-32')} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A row of summary cards, for the dashboard and the portal. */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-32" />
          <Skeleton className="mt-2 h-3 w-40" />
        </div>
      ))}
    </div>
  )
}
