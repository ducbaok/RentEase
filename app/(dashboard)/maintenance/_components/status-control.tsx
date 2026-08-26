'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { advanceStatusAction, type AdvanceState } from '../actions'
import {
  MAINTENANCE_STATUS_LABELS,
  nextStatus,
  type MaintenanceStatus,
} from '@/lib/data/maintenance-status'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Updating…' : label}
    </Button>
  )
}

/**
 * The one control that moves a request forward. Only the adjacent status is
 * offered, so a stale page cannot skip a step; a request that is already done
 * shows nothing to do.
 */
export function StatusControl({ id, status }: { id: string; status: MaintenanceStatus }) {
  const [state, formAction] = useActionState<AdvanceState, FormData>(advanceStatusAction, {})
  const next = nextStatus(status)

  return (
    <div className="space-y-3">
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.message ? (
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {next ? (
        <form action={formAction} className="flex items-center gap-3">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="to" value={next} />
          <SubmitButton label={`Mark as ${MAINTENANCE_STATUS_LABELS[next].toLowerCase()}`} />
          <span className="text-sm text-muted-foreground">
            The resident is emailed when you do.
          </span>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">This request is done. Nothing more to do.</p>
      )}
    </div>
  )
}
