'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import type { PropertyFormState } from './actions'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  )
}

export function PropertyForm({
  action,
  submitLabel,
  cancelHref,
  defaults,
}: {
  action: (state: PropertyFormState, formData: FormData) => Promise<PropertyFormState>
  submitLabel: string
  cancelHref: '/properties' | `/properties/${string}`
  defaults?: { id: string; name: string; address: string | null }
}) {
  const [state, formAction] = useActionState<PropertyFormState, FormData>(action, {})

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {defaults ? <input type="hidden" name="id" value={defaults.id} /> : null}

      <div className="space-y-1.5">
        <Label htmlFor="name">Property name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={defaults?.name}
          placeholder="Cedar Court"
          required
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="address">Address</Label>
        <Input
          id="address"
          name="address"
          defaultValue={defaults?.address ?? ''}
          placeholder="1420 Cedar St, Austin, TX"
        />
        <p className="text-xs text-muted-foreground">Optional — it appears on invoices later.</p>
      </div>

      <div className="flex gap-2 pt-2">
        <SubmitButton label={submitLabel} />
        <Button type="button" variant="ghost" asChild>
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  )
}
