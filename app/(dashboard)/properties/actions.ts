'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireOperator } from '@/lib/auth'
import { createProperty, deleteProperty, updateProperty } from '@/lib/data/properties'

/**
 * Property actions (F1).
 *
 * Server Actions are reachable by direct POST, not only through the form, so
 * every one of them re-establishes who is asking with `requireOperator()`
 * before touching anything. The organization id comes from that call and never
 * from the submitted form — otherwise a hand-crafted request could file a
 * building under somebody else's business.
 */

export interface PropertyFormState {
  error?: string
}

const propertySchema = z.object({
  name: z.string().trim().min(1, 'Give the property a name.').max(120, 'That name is too long.'),
  address: z.string().trim().max(300, 'That address is too long.').optional(),
})

/**
 * Everything a landlord can reach shows a number that a lease or a unit can
 * change — occupancy on the units page, the unit count on this one, the
 * dashboard card in Batch 2. Revalidating the whole layout after a write keeps
 * them from disagreeing with each other for a navigation or two.
 */
function revalidatePortfolio(): void {
  revalidatePath('/', 'layout')
}

function parse(formData: FormData) {
  return propertySchema.safeParse({
    name: formData.get('name'),
    address: formData.get('address'),
  })
}

export async function createPropertyAction(
  _prev: PropertyFormState,
  formData: FormData,
): Promise<PropertyFormState> {
  const { orgId } = await requireOperator()
  const parsed = parse(formData)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }

  const result = await createProperty(orgId, {
    name: parsed.data.name,
    address: parsed.data.address || null,
  })
  if (result.error) return { error: result.error }

  revalidatePortfolio()
  redirect(`/properties/${result.id}`)
}

export async function updatePropertyAction(
  _prev: PropertyFormState,
  formData: FormData,
): Promise<PropertyFormState> {
  const { orgId } = await requireOperator()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'That property no longer exists.' }

  const parsed = parse(formData)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }

  const result = await updateProperty(orgId, id, {
    name: parsed.data.name,
    address: parsed.data.address || null,
  })
  if (result.error) return { error: result.error }

  revalidatePortfolio()
  redirect(`/properties/${id}`)
}

export async function deletePropertyAction(
  _prev: PropertyFormState,
  formData: FormData,
): Promise<PropertyFormState> {
  const { orgId } = await requireOperator()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'That property no longer exists.' }

  const result = await deleteProperty(orgId, id)
  if (result.error) return { error: result.error }

  revalidatePortfolio()
  redirect('/properties')
}
