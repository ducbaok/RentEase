'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { parseAmountToCents } from '@/lib/domain/money'
import { deletePayment, recordPayment, type PaymentMethod } from '@/lib/data/payments'

export interface PaymentFormState {
  error?: string
  message?: string
}

const paymentSchema = z.object({
  invoiceId: z.string().uuid('Choose which invoice this payment is for.'),
  amount: z.string().min(1, 'How much came in?'),
  method: z.enum(['cash', 'bank_transfer']),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the day the money arrived.'),
  note: z.string().max(280, 'Keep the note short.').optional(),
})

export async function recordPaymentAction(
  _prev: PaymentFormState,
  formData: FormData,
): Promise<PaymentFormState> {
  const parsed = paymentSchema.safeParse({
    invoiceId: formData.get('invoiceId'),
    amount: formData.get('amount'),
    method: formData.get('method'),
    paidOn: formData.get('paidOn'),
    note: formData.get('note'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the payment and try again.' }
  }

  const amountCents = parseAmountToCents(parsed.data.amount)
  if (amountCents === null) return { error: 'Enter an amount like 1200.00.' }
  // The database refuses this too (amount_cents > 0); saying so here means the
  // landlord gets a sentence rather than a constraint name.
  if (amountCents <= 0) return { error: 'A payment has to be more than zero.' }

  try {
    await recordPayment({
      invoiceId: parsed.data.invoiceId,
      amountCents,
      method: parsed.data.method as PaymentMethod,
      paidOn: parsed.data.paidOn,
      note: parsed.data.note,
    })
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not record that payment.' }
  }

  revalidatePath('/payments')
  revalidatePath('/invoices')
  revalidatePath(`/invoices/${parsed.data.invoiceId}`)
  revalidatePath('/dashboard')

  return { message: 'Payment recorded. The invoice status has caught up.' }
}

const deleteSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(4, 'Say why this payment is being removed.'),
})

/**
 * Removing a payment is the only way to correct one (there is no edit), so it
 * demands a reason and leaves an audit row behind — otherwise money could
 * disappear from an invoice with no trace of who took it off.
 */
export async function deletePaymentAction(
  _prev: PaymentFormState,
  formData: FormData,
): Promise<PaymentFormState> {
  const parsed = deleteSchema.safeParse({
    id: formData.get('id'),
    reason: formData.get('reason'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Could not remove that payment.' }
  }

  try {
    await deletePayment(parsed.data.id, parsed.data.reason)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not remove that payment.' }
  }

  revalidatePath('/payments')
  revalidatePath('/invoices')
  revalidatePath('/dashboard')

  return { message: 'Payment removed. The invoice balance has been recalculated.' }
}
