'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { advanceMaintenanceStatus } from '@/lib/data/maintenance'

/**
 * Advances a maintenance request's status (operator action, AC8.1).
 *
 * Identity is established inside advanceMaintenanceStatus (requireOperator);
 * this action never reads an org from the form. The data function both checks
 * the transition and emails the resident, so this layer only shapes the result
 * for the form.
 */
export interface AdvanceState {
  error?: string
  message?: string
}

const schema = z.object({
  id: z.uuid(),
  to: z.enum(['submitted', 'in_progress', 'done']),
})

export async function advanceStatusAction(
  _prev: AdvanceState,
  formData: FormData,
): Promise<AdvanceState> {
  const parsed = schema.safeParse({ id: formData.get('id'), to: formData.get('to') })
  if (!parsed.success) {
    return { error: 'That status change is not valid.' }
  }

  try {
    const result = await advanceMaintenanceStatus(parsed.data.id, parsed.data.to)
    revalidatePath('/maintenance')
    revalidatePath(`/maintenance/${parsed.data.id}`)
    return {
      message: result.emailed
        ? 'Status updated and the resident was emailed.'
        : 'Status updated. No email was sent (the resident has no email on file).',
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not update the status.' }
  }
}
