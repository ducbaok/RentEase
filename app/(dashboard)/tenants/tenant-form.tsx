'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import type { TenantFormState } from './actions'
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

export function TenantForm({
  action,
  submitLabel,
  cancelHref,
  defaults,
}: {
  action: (state: TenantFormState, formData: FormData) => Promise<TenantFormState>
  submitLabel: string
  cancelHref: '/tenants' | `/tenants/${string}`
  defaults?: { id: string; fullName: string; email: string | null; phone: string | null }
}) {
  const [state, formAction] = useActionState<TenantFormState, FormData>(action, {})

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {defaults ? <input type="hidden" name="id" value={defaults.id} /> : null}

      <div className="space-y-1.5">
        <Label htmlFor="fullName">Full name</Label>
        <Input
          id="fullName"
          name="fullName"
          defaultValue={defaults?.fullName}
          placeholder="Dana Whitfield"
          required
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          defaultValue={defaults?.email ?? ''}
          placeholder="dana@example.com"
        />
        <p className="text-xs text-muted-foreground">
          Optional now, needed later to invite them to the resident portal and to send reminders.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="phone">Phone</Label>
        <Input
          id="phone"
          name="phone"
          defaultValue={defaults?.phone ?? ''}
          placeholder="+1-512-555-0130"
        />
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
