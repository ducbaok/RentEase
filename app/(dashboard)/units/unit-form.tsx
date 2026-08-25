'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import type { UnitFormState } from './actions'
import type { UnitStatus } from '@/lib/domain/leases'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const selectClasses =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  )
}

export function UnitForm({
  action,
  submitLabel,
  cancelHref,
  properties,
  defaults,
  /**
   * Set when a lease already answers the occupancy question for this unit.
   * The control is then read-only and says who is in it, instead of offering a
   * choice the database would overwrite on the next lease change (AC2.2).
   */
  statusLockedBy,
}: {
  action: (state: UnitFormState, formData: FormData) => Promise<UnitFormState>
  submitLabel: string
  cancelHref: '/properties' | '/units' | `/properties/${string}` | `/units/${string}`
  properties: Array<{ id: string; name: string }>
  defaults?: {
    id?: string
    propertyId?: string
    code?: string
    area?: number | null
    baseRentCents?: number
    status?: UnitStatus
  }
  statusLockedBy?: { tenantName: string } | null
}) {
  const [state, formAction] = useActionState<UnitFormState, FormData>(action, {})

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {defaults?.id ? <input type="hidden" name="id" value={defaults.id} /> : null}

      <div className="space-y-1.5">
        <Label htmlFor="propertyId">Property</Label>
        <select
          id="propertyId"
          name="propertyId"
          className={selectClasses}
          defaultValue={defaults?.propertyId ?? properties[0]?.id ?? ''}
          required
        >
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="code">Unit code</Label>
        <Input
          id="code"
          name="code"
          defaultValue={defaults?.code}
          placeholder="101"
          required
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          Unique within this property — 101 in Cedar Court and 101 in Lakeview Flats are different
          units.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="area">Size</Label>
          <Input
            id="area"
            name="area"
            type="number"
            step="0.01"
            min="0"
            defaultValue={defaults?.area ?? ''}
            placeholder="55"
          />
          <p className="text-xs text-muted-foreground">Optional, in whatever unit you use.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="baseRent">Default rent</Label>
          <Input
            id="baseRent"
            name="baseRent"
            inputMode="decimal"
            defaultValue={
              defaults?.baseRentCents === undefined ? '' : (defaults.baseRentCents / 100).toFixed(2)
            }
            placeholder="1200.00"
            required
          />
          <p className="text-xs text-muted-foreground">Fills in the rent on a new lease.</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="status">Occupancy</Label>
        <select
          id="status"
          name="status"
          className={cn(selectClasses)}
          defaultValue={defaults?.status ?? 'vacant'}
          disabled={Boolean(statusLockedBy)}
        >
          <option value="vacant">Vacant</option>
          <option value="occupied">Occupied</option>
        </select>
        <p className="text-xs text-muted-foreground">
          {statusLockedBy
            ? `Set by the active lease with ${statusLockedBy.tenantName}. End that lease to free the unit.`
            : 'A lease takes this over the moment you create one.'}
        </p>
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
