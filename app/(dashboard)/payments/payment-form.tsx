'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { recordPaymentAction, type PaymentFormState } from './actions'

/*
 * Spelled out here rather than imported from lib/data/payments.ts: that module
 * pulls in the server Supabase client, and dragging it into a client bundle
 * would break the build. The values match the payment_method enum in
 * migration 0100.
 */
const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
] as const

export interface PayableInvoice {
  id: string
  label: string
  outstandingCents: number
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Recording…' : 'Record payment'}
    </Button>
  )
}

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * Recording money that arrived.
 *
 * The amount is pre-filled with what is still owed, because that is what a
 * payment usually is — but it stays editable in both directions. Part payments
 * are ordinary, and an overpayment is accepted rather than argued with: the
 * excess shows up in the invoice's paid amount instead of being quietly lost.
 */
export function PaymentForm({
  invoices,
  fixedInvoiceId,
  today,
  className,
}: {
  invoices: PayableInvoice[]
  fixedInvoiceId?: string
  today: string
  className?: string
}) {
  const [state, formAction] = useActionState<PaymentFormState, FormData>(recordPaymentAction, {})

  const selected = fixedInvoiceId
    ? invoices.find((invoice) => invoice.id === fixedInvoiceId)
    : invoices[0]

  /*
   * The result of the last submission is rendered ABOVE the "nothing left to
   * pay" case, not instead of it. Recording the final payment is exactly what
   * empties this list, so returning early would swallow the confirmation of the
   * one action most worth confirming.
   */
  const result = (
    <>
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
    </>
  )

  if (invoices.length === 0) {
    return (
      <div className={cn('space-y-4', className)}>
        {result}
        <p className="text-sm text-muted-foreground">
          Nothing is outstanding — every issued invoice is settled.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className={cn('space-y-4', className)}>
      {result}

      {fixedInvoiceId ? (
        <input type="hidden" name="invoiceId" value={fixedInvoiceId} />
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="invoiceId">Invoice</Label>
          <select id="invoiceId" name="invoiceId" className={selectClass} required>
            {invoices.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {invoice.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="amount">Amount received ($)</Label>
          <Input
            id="amount"
            name="amount"
            inputMode="decimal"
            defaultValue={selected ? (selected.outstandingCents / 100).toFixed(2) : ''}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="paidOn">Received on</Label>
          <Input id="paidOn" name="paidOn" type="date" defaultValue={today} required />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="method">How</Label>
          <select id="method" name="method" className={selectClass} defaultValue="bank_transfer">
            {PAYMENT_METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="note">Note (optional)</Label>
          <Input id="note" name="note" placeholder="Reference, who handed it over…" />
        </div>
      </div>

      <SubmitButton />
    </form>
  )
}
