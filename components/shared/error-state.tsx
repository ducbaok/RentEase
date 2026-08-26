'use client'

import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * What a route shows when its data could not be loaded.
 *
 * WHAT IT DOES NOT DO: print the error.
 *
 * Almost every failure that reaches here is a rejected database query, and its
 * message is written by Postgres — "new row violates row-level security policy
 * for table \"invoices\"", "permission denied for table users". Those sentences
 * describe the schema and the access rules to whoever triggered them, which is
 * the last thing an access-control failure should do, and they tell a landlord
 * nothing they can act on either. So the reader gets a plain sentence and a
 * retry, and the digest — the id Next records alongside the real stack in the
 * server log — for when they need to report it.
 *
 * `reset()` re-runs the server component, which is the right first move: most
 * of these are a dropped connection or an expired session, and both clear.
 */
export function ErrorState({
  title = 'This did not load',
  description = 'Something went wrong fetching this page. Nothing was changed — trying again is safe.',
  digest,
  reset,
}: {
  title?: string
  description?: string
  digest?: string
  reset?: () => void
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-lg border border-destructive/40 bg-destructive/5 px-6 py-14 text-center"
    >
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="size-5 text-destructive" />
      </div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{description}</p>
      {reset ? (
        <div className="mt-5">
          <Button onClick={reset}>Try again</Button>
        </div>
      ) : null}
      {digest ? (
        <p className="mt-4 font-mono text-xs text-muted-foreground">
          Reference {digest}
        </p>
      ) : null}
    </div>
  )
}
