'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { endLeaseAction, type LeaseFormState } from './actions'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Ending a lease (AC2.2).
 *
 * The date is asked for rather than assumed, because "when did they actually
 * move out" is the fact that decides whether the unit is free for the next
 * resident — and back-dating it is normal, not exceptional.
 */
function ConfirmButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Ending…' : 'End lease'}
    </Button>
  )
}

export function EndLeaseForm({ leaseId, today }: { leaseId: string; today: string }) {
  const [state, formAction] = useActionState<LeaseFormState, FormData>(endLeaseAction, {})
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <div className="mt-8 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">End this lease</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          The resident moves out, the unit goes back to vacant, and the unit becomes available for
          a new lease. Invoices already issued are untouched.
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setOpen(true)}>
          End lease
        </Button>
      </div>
    )
  }

  return (
    <form action={formAction} className="mt-8 rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold">End this lease</h2>

      {state.error ? (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <input type="hidden" name="id" value={leaseId} />

      <div className="mt-3 max-w-xs space-y-1.5">
        <Label htmlFor="endDate">Last day of the lease</Label>
        <Input id="endDate" name="endDate" type="date" defaultValue={today} required autoFocus />
      </div>

      <div className="mt-4 flex gap-2">
        <ConfirmButton />
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
