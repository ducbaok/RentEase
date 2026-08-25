'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { createRequestAction, type NewRequestState } from './actions'
import type { PortalUnitOption } from '@/lib/data/maintenance'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Sending…' : 'Send request'}
    </Button>
  )
}

export function NewRequestForm({ units }: { units: PortalUnitOption[] }) {
  const [state, formAction] = useActionState<NewRequestState, FormData>(createRequestAction, {})
  const onlyUnit = units.length === 1 ? units[0] : undefined

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {onlyUnit ? (
        <input type="hidden" name="unitId" value={onlyUnit.id} />
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="unitId">Which unit</Label>
          <select
            id="unitId"
            name="unitId"
            required
            defaultValue=""
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            <option value="" disabled>
              Choose a unit…
            </option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.propertyName} · {unit.code}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="title">What&apos;s wrong</Label>
        <Input id="title" name="title" required autoFocus placeholder="e.g. Kitchen tap is leaking" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">More detail (optional)</Label>
        <textarea
          id="description"
          name="description"
          rows={4}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
          placeholder="When it started, how bad it is, anything that helps."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="photos">Photos (optional)</Label>
        <Input id="photos" name="photos" type="file" accept="image/*" multiple />
        <p className="text-xs text-muted-foreground">A photo helps your landlord see the problem.</p>
      </div>

      <SubmitButton />
    </form>
  )
}
