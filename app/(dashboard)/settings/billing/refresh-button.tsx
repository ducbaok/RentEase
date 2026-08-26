'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * "Refresh from Stripe" — the owner-triggered half of AC-S1.
 *
 * A webhook can be lost, delayed, or arrive while the landlord is still
 * watching the page. The nightly sweep would fix it by morning; this fixes it
 * now, for one organization, using the same code
 * (app/api/cron/stripe-reconcile).
 *
 * WHY A FETCH AND NOT A SERVER ACTION
 * Correcting the row means writing `subscriptions`, which only the service role
 * may do — and the eslint rule confines that client to app/api/cron/** and
 * app/api/webhooks/**. A Server Action living under app/(dashboard) cannot
 * import it, and should not: that boundary is the reason the write path is
 * auditable at all. So the button calls the route the ordinary way, from the
 * browser, with the session cookie the route authenticates against. The route
 * reads no body and accepts no organization id — it reconciles the caller's own
 * organization or nothing.
 */

interface ReconcileResponse {
  scope?: string
  corrected?: Array<{ orgId: string; changed: string[]; reason: string }>
  inSync?: number
  failed?: Array<{ orgId: string; error: string }>
  error?: string
}

export function RefreshFromStripe({ disabled }: { disabled?: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setBusy(true)
    setMessage(null)
    setError(null)

    try {
      const response = await fetch('/api/cron/stripe-reconcile', { method: 'POST' })
      const body = (await response.json()) as ReconcileResponse

      if (!response.ok) {
        setError(body.error ?? 'Stripe could not be reached.')
        return
      }

      const corrected = body.corrected?.length ?? 0
      const failed = body.failed?.length ?? 0
      if (failed > 0) {
        setError(body.failed?.[0]?.error ?? 'Stripe could not be reached.')
      } else if (corrected > 0) {
        setMessage('Updated from Stripe.')
        // The page is a Server Component reading the row this just corrected.
        startTransition(() => router.refresh())
      } else {
        setMessage('Already up to date with Stripe.')
      }
    } catch {
      setError('Could not reach the server to check with Stripe.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="ghost" size="sm" onClick={refresh} disabled={busy || pending || disabled}>
        {busy || pending ? 'Checking with Stripe…' : 'Refresh from Stripe'}
      </Button>
      {message ? (
        <Alert variant="success">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
