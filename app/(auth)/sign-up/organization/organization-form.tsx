'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { createOrganization, type AuthActionState } from '../../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Setting things up…' : 'Continue'}
    </Button>
  )
}

export function OrganizationForm() {
  const [state, formAction] = useActionState<AuthActionState, FormData>(createOrganization, {})

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="orgName">Business name</Label>
        <Input
          id="orgName"
          name="orgName"
          placeholder="Northside Rentals"
          required
          autoFocus
          minLength={2}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fullName">Your name (optional)</Label>
        <Input id="fullName" name="fullName" placeholder="Alice Nguyen" autoComplete="name" />
      </div>

      <SubmitButton />
    </form>
  )
}
