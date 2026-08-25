'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import type { TariffFormState } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ELECTRIC_UNIT, WATER_UNIT } from '@/lib/domain/billing'

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  )
}

export interface TariffFormValues {
  id?: string
  electricRatePerKwh: number
  waterRatePerUnit: number
  serviceFeeCents: number
  effectiveFrom: string
}

export function TariffForm({
  action,
  values,
  submitLabel,
}: {
  action: (state: TariffFormState, formData: FormData) => Promise<TariffFormState>
  values: TariffFormValues
  submitLabel: string
}) {
  const [state, formAction] = useActionState<TariffFormState, FormData>(action, {})

  return (
    <form action={formAction} className="space-y-4">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.message ? (
        <Alert variant="success">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="effectiveFrom">Rates start on</Label>
          <Input
            id="effectiveFrom"
            name="effectiveFrom"
            type="date"
            defaultValue={values.effectiveFrom}
            required
          />
          <p className="text-xs text-muted-foreground">
            A period is priced with the newest card in effect by the end of that month.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="serviceFee">Service fee per month ($)</Label>
          <Input
            id="serviceFee"
            name="serviceFee"
            type="number"
            step="0.01"
            min="0"
            defaultValue={(values.serviceFeeCents / 100).toFixed(2)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="electricRatePerKwh">Electricity ($ per {ELECTRIC_UNIT})</Label>
          <Input
            id="electricRatePerKwh"
            name="electricRatePerKwh"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={values.electricRatePerKwh}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="waterRatePerUnit">Water ($ per {WATER_UNIT})</Label>
          <Input
            id="waterRatePerUnit"
            name="waterRatePerUnit"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={values.waterRatePerUnit}
            required
          />
        </div>
      </div>

      <SubmitButton label={submitLabel} />
    </form>
  )
}
