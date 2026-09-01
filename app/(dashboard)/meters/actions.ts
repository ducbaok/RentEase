'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireOperator } from '@/lib/auth'
import { getAiProvider } from '@/lib/ai/provider'
import type { MeterReadingSuggestion } from '@/lib/ai/schemas'
import type { AiFailureReason } from '@/lib/ai/types'
import { recordAiCall } from '@/lib/ai/rate-limit'
import {
  MAX_PHOTO_BYTES,
  photoMediaType,
  readMeterPhoto,
} from '@/lib/ai/tasks/meter-ocr'
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

// ---------------------------------------------------------------------------
// Meter photo (F9) — READ ONLY
// ---------------------------------------------------------------------------

export interface MeterPhotoState {
  /** What the model read, for the form to pre-fill. Absent when there is none. */
  suggestion?: MeterReadingSuggestion
  /**
   * Why there is no suggestion, in a sentence a landlord can act on. Set
   * whenever `suggestion` is not — the screen always has something to say, and
   * what it says is never "an error occurred".
   */
  unavailable?: string
}

/**
 * One sentence per way of not getting an answer.
 *
 * None of them are failures of the product: manual entry is the normal path and
 * it is untouched (AC9.4). So none of them read like an outage, and none of
 * them leak a provider message — a rate-limit body or a rejected-key error says
 * things about our account, not about this photo.
 */
const NO_SUGGESTION: Record<AiFailureReason, string> = {
  no_provider: 'Photo reading is switched off. Type the numbers in as usual.',
  network: 'Could not reach the reading service just now. Type the numbers in as usual.',
  invalid_output: 'Could not make out this photo. Type the numbers in, or try a closer shot.',
  refused: 'Could not read this photo. Type the numbers in as usual.',
}

/**
 * Reads a photo of a meter and offers the numbers. WRITES NOTHING.
 *
 * Three things about this action are load-bearing.
 *
 * 1. It is read-only, and that is structural rather than a promise. It does not
 *    import saveReadings, it calls no data function, and it does not
 *    revalidate: the only path from a photo to a stored row runs through a
 *    person retyping or accepting the number and submitting the form, which is
 *    saveReadingsAction (AC9.6). A suggestion is never a reading.
 *
 * 2. requireOperator() is first, and it is not a formality. This action spends
 *    real money on our Anthropic key every time it runs. An unauthenticated
 *    caller who can reach it is not a data leak — there is no data here — it is
 *    an invoice, and one anybody with the endpoint could run up. The size cap
 *    and the media-type check below are the second half of that: they are what
 *    stops a signed-in operator from posting a 200 MB file, or a hundred of
 *    them, before we have paid to find out it was not a meter.
 *
 *    Being signed in is a lower bar than it sounds, though, which is why the
 *    count in lib/ai/rate-limit.ts is here too: the landing page publishes
 *    working demo credentials (D23), so the set of people who can reach this
 *    action is the set of people who can read the home page. Identity bounds
 *    WHO spends; only the count bounds HOW MUCH.
 *
 * 3. It never throws (AC9.5). Every way this can go wrong returns a labelled
 *    state, because a fault in the AI layer must not be able to take the meter
 *    screen down with it. The one exception is deliberate: requireOperator()
 *    sits OUTSIDE the try, since it signals "not signed in" by throwing Next's
 *    redirect, and catching that would turn a redirect into a shrug.
 */
export async function readMeterPhotoAction(
  _prev: MeterPhotoState,
  formData: FormData,
): Promise<MeterPhotoState> {
  const operator = await requireOperator()

  const photo = formData.get('photo')
  if (!(photo instanceof File) || photo.size === 0) {
    return { unavailable: 'Attach a photo of the meter first.' }
  }

  // The type is checked before the bytes are touched, so a video that was
  // renamed to .jpg costs us a string comparison and nothing else.
  const mediaType = photoMediaType(photo.type)
  if (!mediaType) {
    return { unavailable: 'That is not a photo. Attach a JPEG, PNG, WebP or GIF.' }
  }

  if (photo.size > MAX_PHOTO_BYTES) {
    const limit = Math.floor(MAX_PHOTO_BYTES / 1_000_000)
    return { unavailable: `That photo is over ${limit} MB. Take a smaller one, or type the numbers in.` }
  }

  /*
   * Counted here rather than at the top, so that only the calls which are about
   * to cost something count. Somebody fumbling a video and two PDFs into the
   * picker has spent nothing and has used none of their round.
   */
  const budget = recordAiCall(operator.userId, Date.now())
  if (!budget.ok) {
    const minutes = Math.max(1, Math.ceil(budget.retryAfterMs / 60_000))
    return {
      unavailable:
        `That is a lot of photos at once. Photo reading pauses for about ${minutes} ` +
        `minute${minutes === 1 ? '' : 's'} — type the numbers in as usual.`,
    }
  }

  try {
    const data = Buffer.from(await photo.arrayBuffer()).toString('base64')
    const result = await readMeterPhoto(getAiProvider(), { mediaType, data })

    if (!result.ok) {
      return { unavailable: NO_SUGGESTION[result.reason] }
    }

    return { suggestion: result.value }
  } catch {
    // readMeterPhoto() resolves rather than rejects by contract, so reaching
    // here means something below it broke its own promise — an unreadable
    // upload stream, a provider that threw. It is still not the meter screen's
    // problem, and the person still has a keyboard.
    return { unavailable: NO_SUGGESTION.network }
  }
}
