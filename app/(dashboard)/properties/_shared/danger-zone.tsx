'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * Delete, with the second click that makes it deliberate.
 *
 * Used by every screen in stream 1A (properties, units, residents, leases).
 * It lives in a private folder under `properties/` rather than in
 * `components/shared/` because a stream may only add shared code inside its
 * own area while the batch is running — see CLAUDE.md. Promote it at merge.
 *
 * The confirmation is inline state rather than `window.confirm` so it renders
 * in the page, reads on a phone, and can be driven by a test without hooking
 * a browser dialog.
 */

export interface DeleteFormState {
  error?: string
}

function ConfirmButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="destructive" size="sm" disabled={pending}>
      {pending ? 'Deleting…' : label}
    </Button>
  )
}

export function DangerZone({
  action,
  id,
  title,
  description,
  buttonLabel,
  confirmLabel,
  /** When set, deletion is refused up front and this explains why. */
  blockedReason,
}: {
  action: (state: DeleteFormState, formData: FormData) => Promise<DeleteFormState>
  id: string
  title: string
  description: string
  buttonLabel: string
  confirmLabel: string
  blockedReason?: string | null
}) {
  const [state, formAction] = useActionState<DeleteFormState, FormData>(action, {})
  const [confirming, setConfirming] = useState(false)

  return (
    <section className="mt-10 rounded-lg border border-destructive/40 p-4">
      <h2 className="text-sm font-semibold text-destructive">{title}</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>

      {state.error ? (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {blockedReason ? (
        <p className="mt-3 text-sm text-muted-foreground">{blockedReason}</p>
      ) : confirming ? (
        <form action={formAction} className="mt-3 flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <ConfirmButton label={confirmLabel} />
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Keep it
          </Button>
        </form>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 border-destructive/50 text-destructive"
          onClick={() => setConfirming(true)}
        >
          {buttonLabel}
        </Button>
      )}
    </section>
  )
}
