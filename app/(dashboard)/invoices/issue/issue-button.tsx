'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { issueInvoicesAction, type IssueFormState } from '../actions'

function Submit({ count, disabled }: { count: number; disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending
        ? 'Issuing…'
        : count === 0
          ? 'Issue invoices'
          : `Issue ${count} invoice${count === 1 ? '' : 's'}`}
    </Button>
  )
}

/**
 * The button that bills the building.
 *
 * It is deliberately not disabled after a successful run. Pressing it twice is
 * the thing AC4.1 promises is safe, and hiding the button would only hide the
 * promise — the second press reports "nothing to issue" because the database
 * refused the duplicates, which is what a landlord needs to be able to see.
 */
export function IssueButton({ period, count, disabled }: { period: string; count: number; disabled: boolean }) {
  const [state, formAction] = useActionState<IssueFormState, FormData>(issueInvoicesAction, {})

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="period" value={period} />

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.message ? (
        <Alert variant="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <Submit count={count} disabled={disabled} />
    </form>
  )
}
