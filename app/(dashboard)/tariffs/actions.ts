'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createTariff, deleteTariff, updateTariff } from '@/lib/data/tariffs'

export interface TariffFormState {
  error?: string
  message?: string
}

/**
 * Rates are entered in currency, not cents: a landlord reads $0.1425/kWh off a
 * utility bill and should type exactly that. The service fee is a whole charge,
 * so it is parsed to integer cents before it goes anywhere near the database.
 */
const tariffSchema = z.object({
  electricRatePerKwh: z.coerce
    .number()
    .min(0, 'An electricity rate cannot be negative.')
    .max(1000, 'That electricity rate looks like a typo.'),
  waterRatePerUnit: z.coerce
    .number()
    .min(0, 'A water rate cannot be negative.')
    .max(1000, 'That water rate looks like a typo.'),
  serviceFee: z.coerce.number().min(0, 'A service fee cannot be negative.'),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date these rates start.'),
})

function parse(formData: FormData) {
  return tariffSchema.safeParse({
    electricRatePerKwh: formData.get('electricRatePerKwh'),
    waterRatePerUnit: formData.get('waterRatePerUnit'),
    serviceFee: formData.get('serviceFee'),
    effectiveFrom: formData.get('effectiveFrom'),
  })
}

/** Postgres speaks in codes; a landlord needs to know what to do next. */
function readable(message: string): string {
  if (message.includes('tariffs_org_id_effective_from_key') || message.includes('duplicate key')) {
    return 'You already have rates starting on that date. Edit those instead of adding a second card.'
  }
  return message
}

export async function createTariffAction(
  _prev: TariffFormState,
  formData: FormData,
): Promise<TariffFormState> {
  const parsed = parse(formData)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the rates and try again.' }
  }

  try {
    await createTariff({
      electricRatePerKwh: parsed.data.electricRatePerKwh,
      waterRatePerUnit: parsed.data.waterRatePerUnit,
      serviceFeeCents: Math.round(parsed.data.serviceFee * 100),
      effectiveFrom: parsed.data.effectiveFrom,
    })
  } catch (error) {
    return { error: readable(error instanceof Error ? error.message : 'Could not save these rates.') }
  }

  revalidatePath('/tariffs')
  return { message: 'Rates saved.' }
}

export async function updateTariffAction(
  _prev: TariffFormState,
  formData: FormData,
): Promise<TariffFormState> {
  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Which rate card?' }

  const parsed = parse(formData)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the rates and try again.' }
  }

  try {
    await updateTariff(id, {
      electricRatePerKwh: parsed.data.electricRatePerKwh,
      waterRatePerUnit: parsed.data.waterRatePerUnit,
      serviceFeeCents: Math.round(parsed.data.serviceFee * 100),
      effectiveFrom: parsed.data.effectiveFrom,
    })
  } catch (error) {
    return { error: readable(error instanceof Error ? error.message : 'Could not save these rates.') }
  }

  revalidatePath('/tariffs')
  redirect('/tariffs')
}

export async function deleteTariffAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await deleteTariff(id)
  revalidatePath('/tariffs')
}
