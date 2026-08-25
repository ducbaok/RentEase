'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { assertPeriod } from '@/lib/domain/period'
import { parseAmountToCents } from '@/lib/domain/money'
import { adjustInvoice, issueInvoices } from '@/lib/data/invoices'

export interface IssueFormState {
  error?: string
  message?: string
}

/**
 * AC4.1 from the outside.
 *
 * Nothing here guards against a double click: the insert is ON CONFLICT DO
 * NOTHING against a unique constraint, so the second press is a no-op in the
 * database rather than a race this action tried to win. What it does do is
 * report honestly — "already issued, nothing added" — instead of claiming a
 * success that did not happen.
 */
export async function issueInvoicesAction(
  _prev: IssueFormState,
  formData: FormData,
): Promise<IssueFormState> {
  let period: string
  try {
    period = assertPeriod(String(formData.get('period') ?? ''))
  } catch {
    return { error: 'That is not a billing period.' }
  }

  let result
  try {
    result = await issueInvoices(period)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not issue these invoices.' }
  }

  revalidatePath('/invoices')
  revalidatePath('/invoices/issue')
  revalidatePath('/dashboard')

  if (result.created === 0) {
    return {
      message: `Nothing to issue — every active lease already has an invoice for ${period}.`,
    }
  }

  return {
    message:
      `Issued ${result.created} invoice${result.created === 1 ? '' : 's'} for ${period}.` +
      (result.skipped > 0 ? ` ${result.skipped} already existed and ${result.skipped === 1 ? 'was' : 'were'} left alone.` : ''),
  }
}

export interface AdjustFormState {
  error?: string
  message?: string
}

const adjustSchema = z.object({
  id: z.string().uuid('Which invoice?'),
  rent: z.string(),
  otherAmount: z.string(),
  otherLabel: z.string().max(120, 'Keep the label short.').optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a due date.'),
  reason: z.string().trim().min(4, 'Say why you are changing this — it goes in the audit trail.'),
})

/**
 * AC5.2 — correcting a bill that already went out.
 *
 * The reason is mandatory, and short-circuiting it is not possible: the write
 * and the audit entry both happen inside lib/data/invoices.ts::adjustInvoice.
 */
export async function adjustInvoiceAction(
  _prev: AdjustFormState,
  formData: FormData,
): Promise<AdjustFormState> {
  const parsed = adjustSchema.safeParse({
    id: formData.get('id'),
    rent: formData.get('rent'),
    otherAmount: formData.get('otherAmount'),
    otherLabel: formData.get('otherLabel'),
    dueDate: formData.get('dueDate'),
    reason: formData.get('reason'),
  })

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the changes and try again.' }
  }

  const rentCents = parseAmountToCents(parsed.data.rent)
  const otherCents = parseAmountToCents(parsed.data.otherAmount || '0')

  if (rentCents === null || rentCents < 0) return { error: 'Rent must be an amount like 1200.00.' }
  if (otherCents === null || otherCents < 0) {
    return { error: 'Other charges must be an amount like 45.00.' }
  }

  try {
    await adjustInvoice(parsed.data.id, {
      rentCents,
      otherCents,
      otherLabel: parsed.data.otherLabel ?? '',
      dueDate: parsed.data.dueDate,
      reason: parsed.data.reason,
    })
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save that change.' }
  }

  revalidatePath(`/invoices/${parsed.data.id}`)
  revalidatePath('/invoices')
  return { message: 'Invoice updated. The change is in the history below.' }
}
