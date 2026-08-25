'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { deletePaymentAction, type PaymentFormState } from './actions'

function ConfirmButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="destructive" size="sm" disabled={pending}>
      {pending ? 'Removing…' : 'Remove'}
    </Button>
  )
}

/**
 * Undoing a payment, in two steps.
 *
 * The reason field appears before the destructive button rather than after it,
 * so removing money from an invoice is never one stray click — and whatever is
 * typed goes into the audit trail, which is the only record that the payment
 * ever existed.
 */
export function DeletePaymentForm({ paymentId }: { paymentId: string }) {
  const [state, formAction] = useActionState<PaymentFormState, FormData>(deletePaymentAction, {})
  const [open, setOpen] = useState(false)

  /*
   * There is no success message: a removed payment takes its own row off the
   * page, and the invoice's balance updates with it. A confirmation rendered
   * inside a row that no longer exists would be a message about nothing.
   */
  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Remove
      </Button>
    )
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={paymentId} />
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <Input
        name="reason"
        aria-label="Why this payment is being removed"
        placeholder="Why? e.g. entered twice"
        className="h-8 text-xs"
        required
        autoFocus
      />
      <div className="flex gap-2">
        <ConfirmButton />
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
