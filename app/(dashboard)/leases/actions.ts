'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireOperator } from '@/lib/auth'
import {
  createLease,
  deleteLease,
  endLease,
  getLease,
  updateLease,
  type LeaseInput,
} from '@/lib/data/leases'
import { parseAmountToCents } from '@/lib/domain/money'
import { validateLeaseDraft, validateLeaseEnd, type LeaseDraft } from '@/lib/domain/leases'
import { checkCreateAllowance } from '@/lib/stripe/entitlement'

/**
 * Lease actions (F2).
 *
 * Validation runs through `lib/domain/leases`, which is pure and covered by
 * tests/unit/leases.test.ts, so the rules a landlord meets on screen are the
 * same ones asserted there. None of it is the defence: the EXCLUDE constraint
 * refuses a second active lease on a unit (AC2.1) and the check constraints
 * refuse a backwards term whatever this file does.
 */

export interface LeaseFormState {
  error?: string
}

function revalidatePortfolio(): void {
  // A lease moves its unit between vacant and occupied (AC2.2), which moves
  // the occupancy rate on other screens. Refresh the whole shell so no page
  // shows yesterday's answer.
  revalidatePath('/', 'layout')
}

/** Reads the form into the shape the domain module validates. */
function draftFrom(formData: FormData): LeaseDraft {
  const endDate = String(formData.get('endDate') ?? '').trim()
  return {
    unitId: String(formData.get('unitId') ?? '').trim(),
    tenantId: String(formData.get('tenantId') ?? '').trim(),
    startDate: String(formData.get('startDate') ?? '').trim(),
    endDate: endDate === '' ? null : endDate,
    rentCents: parseAmountToCents(String(formData.get('rent') ?? '')),
    depositCents: parseAmountToCents(String(formData.get('deposit') ?? '0') || '0'),
    billingDay: Number(formData.get('billingDay') ?? Number.NaN),
  }
}

/**
 * Validates a draft and, if it holds up, hands back the exact shape the data
 * layer writes. Doing both in one step is what lets the rest of this file stay
 * free of non-null assertions on money that has already been checked.
 */
function checked(draft: LeaseDraft): { error: string } | { input: LeaseInput } {
  const problem = validateLeaseDraft(draft)[0]
  if (problem) return { error: problem.message }

  return {
    input: {
      unitId: draft.unitId,
      tenantId: draft.tenantId,
      startDate: draft.startDate,
      endDate: draft.endDate,
      rentCents: draft.rentCents ?? 0,
      depositCents: draft.depositCents ?? 0,
      billingDay: draft.billingDay,
    },
  }
}

export async function createLeaseAction(
  _prev: LeaseFormState,
  formData: FormData,
): Promise<LeaseFormState> {
  const { orgId } = await requireOperator()

  // AC-S2 / AC-S3 (stream 3A). Refuses only the NEW record; everything already
  // recorded stays readable and writable.
  const allowance = await checkCreateAllowance('lease')
  if (!allowance.allowed) return { error: allowance.message }

  const parsed = checked(draftFrom(formData))
  if ('error' in parsed) return { error: parsed.error }

  const result = await createLease(orgId, parsed.input)
  if (result.error) return { error: result.error }

  revalidatePortfolio()
  redirect(`/leases/${result.id}`)
}

export async function updateLeaseAction(
  _prev: LeaseFormState,
  formData: FormData,
): Promise<LeaseFormState> {
  const { orgId } = await requireOperator()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'That lease no longer exists.' }

  const parsed = checked(draftFrom(formData))
  if ('error' in parsed) return { error: parsed.error }

  const result = await updateLease(orgId, id, parsed.input)
  if (result.error) return { error: result.error }

  revalidatePortfolio()
  redirect(`/leases/${id}`)
}

/**
 * AC2.2, the second half: ending the lease is what sends the unit back to
 * vacant. The status change and the end date go in one write, and the unit
 * follows from the database trigger rather than from anything here.
 */
export async function endLeaseAction(
  _prev: LeaseFormState,
  formData: FormData,
): Promise<LeaseFormState> {
  const { orgId } = await requireOperator()
  const id = String(formData.get('id') ?? '')
  const endDate = String(formData.get('endDate') ?? '').trim()
  if (!id) return { error: 'That lease no longer exists.' }

  const lease = await getLease(orgId, id)
  if (!lease) return { error: 'That lease no longer exists.' }

  const problem = validateLeaseEnd(
    { status: lease.status, startDate: lease.startDate, endDate: lease.endDate },
    endDate,
  )
  if (problem) return { error: problem }

  const result = await endLease(orgId, id, endDate)
  if (result.error) return { error: result.error }

  revalidatePortfolio()
  redirect(`/leases/${id}`)
}

export async function deleteLeaseAction(
  _prev: LeaseFormState,
  formData: FormData,
): Promise<LeaseFormState> {
  const { orgId } = await requireOperator()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'That lease no longer exists.' }

  const result = await deleteLease(orgId, id)
  if (result.error) return { error: result.error }

  revalidatePortfolio()
  redirect('/leases')
}
