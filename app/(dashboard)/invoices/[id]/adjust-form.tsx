'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adjustInvoiceAction, type AdjustFormState } from '../actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save change'}
    </Button>
  )
}

/**
 * AC5.2 — changing a bill after it went out.
 *
 * Only rent and other charges are editable. The metered lines are arithmetic
 * over the meter readings, so correcting those means correcting the reading —
 * which has its own audit trail — rather than typing a different answer over
 * the top of the working the invoice shows.
 *
 * The reason is required by the schema in the action, not just by this form.
 */
export function AdjustForm({
  invoiceId,
  rentCents,
  otherCents,
  otherLabel,
  dueDate,
}: {
  invoiceId: string
  rentCents: number
  otherCents: number
  otherLabel: string
  dueDate: string
}) {
  const [state, formAction] = useActionState<AdjustFormState, FormData>(adjustInvoiceAction, {})
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <div className="space-y-2">
        {state.message ? (
          <Alert variant="success">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        <Button variant="outline" onClick={() => setOpen(true)}>
          Correct this invoice
        </Button>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={invoiceId} />

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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rent">Rent ($)</Label>
          <Input
            id="rent"
            name="rent"
            inputMode="decimal"
            defaultValue={(rentCents / 100).toFixed(2)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dueDate">Due date</Label>
          <Input id="dueDate" name="dueDate" type="date" defaultValue={dueDate} required />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="otherAmount">Other charges ($)</Label>
          <Input
            id="otherAmount"
            name="otherAmount"
            inputMode="decimal"
            defaultValue={(otherCents / 100).toFixed(2)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="otherLabel">What for</Label>
          <Input
            id="otherLabel"
            name="otherLabel"
            defaultValue={otherLabel}
            placeholder="Replacement key, cleaning…"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reason">Why (recorded in the history)</Label>
        <Input
          id="reason"
          name="reason"
          placeholder="Agreed a reduction for the week without hot water"
          required
          minLength={4}
        />
      </div>

      <div className="flex gap-2">
        <SubmitButton />
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
