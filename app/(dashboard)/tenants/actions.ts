'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireOperator } from '@/lib/auth'
import { createTenant, deleteTenant, updateTenant } from '@/lib/data/tenants'

/**
 * Resident actions (F1).
 *
 * Email is optional on purpose. A resident who never opens the portal must
 * still be billable — the seed has one — so the record has to be creatable
 * with a name alone. Stream 2A is what turns an email address into a portal
 * invite; nothing here writes `portal_user_id`.
 */

export interface TenantFormState {
  error?: string
}

const tenantSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter the resident’s name.').max(160),
  email: z
    .string()
    .trim()
    .max(320)
    .optional()
    .refine((value) => !value || z.email().safeParse(value).success, {
      message: 'That does not look like an email address.',
    }),
  phone: z.string().trim().max(40).optional(),
})

function revalidatePortfolio(): void {
  revalidatePath('/', 'layout')
}

function parse(formData: FormData) {
  return tenantSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
  })
}

export async function createTenantAction(
  _prev: TenantFormState,
  formData: FormData,
): Promise<TenantFormState> {
  const { orgId } = await requireOperator()
  const parsed = parse(formData)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }

  const result = await createTenant(orgId, {
    fullName: parsed.data.fullName,
    email: parsed.data.email || null,
    phone: parsed.data.phone || null,
  })
  if (result.error) return { error: result.error }

  revalidatePortfolio()
  redirect(`/tenants/${result.id}`)
}

export async function updateTenantAction(
  _prev: TenantFormState,
  formData: FormData,
): Promise<TenantFormState> {
  const { orgId } = await requireOperator()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'That resident no longer exists.' }

  const parsed = parse(formData)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' }

  const result = await updateTenant(orgId, id, {
    fullName: parsed.data.fullName,
    email: parsed.data.email || null,
    phone: parsed.data.phone || null,
  })
  if (result.error) return { error: result.error }

  revalidatePortfolio()
  redirect(`/tenants/${id}`)
}

export async function deleteTenantAction(
  _prev: TenantFormState,
  formData: FormData,
): Promise<TenantFormState> {
  const { orgId } = await requireOperator()
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'That resident no longer exists.' }

  const result = await deleteTenant(orgId, id)
  if (result.error) return { error: result.error }

  revalidatePortfolio()
  redirect('/tenants')
}
