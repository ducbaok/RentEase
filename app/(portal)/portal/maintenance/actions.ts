'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createMaintenanceRequest } from '@/lib/data/maintenance'

/**
 * Files a maintenance request from the portal.
 *
 * Identity is resolved inside createMaintenanceRequest (requireTenant), never
 * taken from the form — the unit id is validated against the resident's own
 * leases by the INSERT policy regardless of what the form submits.
 */
export interface NewRequestState {
  error?: string
}

const schema = z.object({
  unitId: z.uuid('Choose which unit this is about.'),
  title: z.string().trim().min(1, 'Give the problem a short title.'),
  description: z.string().trim().optional(),
})

export async function createRequestAction(
  _prev: NewRequestState,
  formData: FormData,
): Promise<NewRequestState> {
  const parsed = schema.safeParse({
    unitId: formData.get('unitId'),
    title: formData.get('title'),
    description: formData.get('description') || undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' }
  }

  const photos = formData
    .getAll('photos')
    .filter((entry): entry is File => entry instanceof File && entry.size > 0)

  let id: string
  try {
    id = await createMaintenanceRequest({
      unitId: parsed.data.unitId,
      title: parsed.data.title,
      description: parsed.data.description,
      photos,
    })
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not file the request.' }
  }

  revalidatePath('/portal/maintenance')
  redirect(`/portal/maintenance/${id}`)
}
