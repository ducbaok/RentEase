'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireOperator } from '@/lib/auth'
import { createUnit, deleteUnit, getUnit, updateUnit } from '@/lib/data/units'
import { parseAmountToCents } from '@/lib/domain/money'

/**
 * Unit actions (F1).
 *
 * The interesting rule here is what happens to `status`. A unit with a lease
 * covering today is occupied because the lease says so — `sync_unit_status_for`
 * writes that column on every lease change (AC2.2) — so a status submitted for
 * such a unit is dropped on the floor rather than written and then silently
 * overwritten by the next lease edit. Only a unit that no lease speaks for can
 * be set by hand.
 */

export interface UnitFormState {
  error?: string
}

const unitSchema = z.object({
  propertyId: z.uuid('Choose which property this unit belongs to.'),
  code: z.string().trim().min(1, 'Give the unit a code, for example 101 or 2B.').max(40),
  area: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? Number(value) : null))
    .refine((value) => value === null || (Number.isFinite(value) && value > 0), {
      message: 'Size must be a number greater than zero, or left blank.',
    }),
  baseRent: z
    .string()
    .trim()
    .transform((value) => (value === '' ? 0 : parseAmountToCents(value)))
    .refine((cents): cents is number => cents !== null && cents >= 0, {
      message: 'Enter the default rent as an amount, for example 1200.00.',
    }),
  status: z.enum(['vacant', 'occupied']),
})

function revalidatePortfolio(): void {
  revalidatePath('/', 'layout')
}

function parse(formData: FormData) {
  return unitSchema.safeParse({
    propertyId: formData.get('propertyId'),
    code: formData.get('code'),
    area: formData.get('area'),
    baseRent: formData.get('baseRent'),
    status: formData.get('status') ?? 'vacant',
  })
}

export async function createUnitAction(
  _prev: UnitFormState,
  formData: FormData,
): Promise<UnitFormState> {
  const { orgId } = await requireOperator()
  const parsed = parse(formData)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }

  const result = await createUnit(orgId, {
    propertyId: parsed.data.propertyId,
    code: parsed.data.code,
    area: parsed.data.area,
    baseRentCents: parsed.data.baseRent,
    status: parsed.data.status,
  })
  if (result.error) return { error: result.error }

  revalidatePortfolio()
  redirect(`/units/${result.id}`)
}

export async function updateUnitAction(
  _prev: UnitFormState,
  formData: FormData,
): Promise<UnitFormState> {
  const { orgId } = await requireOperator()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'That unit no longer exists.' }

  const parsed = parse(formData)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }

  const existing = await getUnit(orgId, id)
  if (!existing) return { error: 'That unit no longer exists.' }

  const result = await updateUnit(orgId, id, {
    propertyId: parsed.data.propertyId,
    code: parsed.data.code,
    area: parsed.data.area,
    baseRentCents: parsed.data.baseRent,
    // Withheld while a lease owns the answer — see the note at the top.
    status: existing.currentLease ? undefined : parsed.data.status,
  })
  if (result.error) return { error: result.error }

  revalidatePortfolio()
  redirect(`/units/${id}`)
}

export async function deleteUnitAction(
  _prev: UnitFormState,
  formData: FormData,
): Promise<UnitFormState> {
  const { orgId } = await requireOperator()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'That unit no longer exists.' }

  const unit = await getUnit(orgId, id)
  if (!unit) return { error: 'That unit no longer exists.' }

  const result = await deleteUnit(orgId, id)
  if (result.error) return { error: result.error }

  revalidatePortfolio()
  redirect(`/properties/${unit.propertyId}`)
}
