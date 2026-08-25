'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { assertPeriod } from '@/lib/domain/period'
import { saveReadings, type ReadingSubmission } from '@/lib/data/meters'

export interface MeterFormState {
  error?: string
  message?: string
  /** Unit ids the server refused because a reading dropped and nobody confirmed it (AC3.1). */
  needsConfirmation?: string[]
}

const numberSchema = z.coerce
  .number()
  .min(0, 'A meter reading cannot be negative.')
  .max(99_999_999, 'That reading is larger than any meter goes.')

/**
 * Reads the sheet back out of the form.
 *
 * A unit is only submitted when BOTH of its meters carry a number. Half a row
 * would mean inventing the other meter's reading, and the database stores the
 * pair — so an incomplete row is left for next time rather than guessed at.
 */
function collect(formData: FormData): {
  submissions: ReadingSubmission[]
  invalid: string[]
} {
  const submissions: ReadingSubmission[] = []
  const invalid: string[] = []

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('electric-')) continue
    const unitId = key.slice('electric-'.length)

    const electricRaw = String(value ?? '').trim()
    const waterRaw = String(formData.get(`water-${unitId}`) ?? '').trim()
    if (electricRaw === '' || waterRaw === '') continue

    const electric = numberSchema.safeParse(electricRaw)
    const water = numberSchema.safeParse(waterRaw)
    if (!electric.success || !water.success) {
      invalid.push(unitId)
      continue
    }

    submissions.push({
      unitId,
      electricCurr: electric.data,
      waterCurr: water.data,
      confirmed: formData.get(`confirm-${unitId}`) === 'on',
      reason: String(formData.get(`reason-${unitId}`) ?? ''),
    })
  }

  return { submissions, invalid }
}

export async function saveReadingsAction(
  _prev: MeterFormState,
  formData: FormData,
): Promise<MeterFormState> {
  let period: string
  try {
    period = assertPeriod(String(formData.get('period') ?? ''))
  } catch {
    return { error: 'That is not a billing period.' }
  }

  const { submissions, invalid } = collect(formData)
  if (invalid.length > 0) {
    return { error: 'Some readings are not numbers. Check the highlighted units.' }
  }
  if (submissions.length === 0) {
    return { error: 'Nothing to save — enter both meters for at least one unit.' }
  }

  let result
  try {
    result = await saveReadings(period, submissions)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save these readings.' }
  }

  revalidatePath('/meters')

  if (result.needsConfirmation.length > 0) {
    const saved = result.saved + result.updated
    return {
      needsConfirmation: result.needsConfirmation.map((row) => row.unitId),
      error:
        `${result.needsConfirmation.length} reading${result.needsConfirmation.length === 1 ? '' : 's'} ` +
        `came in lower than last month and ${result.needsConfirmation.length === 1 ? 'was' : 'were'} not saved. ` +
        `Confirm ${result.needsConfirmation.length === 1 ? 'it' : 'them'} below, or fix the number.` +
        (saved > 0 ? ` The other ${saved} saved fine.` : ''),
    }
  }

  const parts: string[] = []
  if (result.saved > 0) parts.push(`${result.saved} saved`)
  if (result.updated > 0) parts.push(`${result.updated} updated`)

  return { message: `Readings ${parts.join(', ')}.` }
}
