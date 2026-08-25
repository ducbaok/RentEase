'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import type { LeaseFormState } from './actions'
import { MAX_BILLING_DAY, MIN_BILLING_DAY, type UnitStatus } from '@/lib/domain/leases'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const selectClasses =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

export interface UnitOption {
  id: string
  label: string
  status: UnitStatus
  baseRentCents: number
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  )
}

export function LeaseForm({
  action,
  submitLabel,
  cancelHref,
  units,
  tenants,
  defaults,
}: {
  action: (state: LeaseFormState, formData: FormData) => Promise<LeaseFormState>
  submitLabel: string
  cancelHref: '/leases' | '/units' | `/leases/${string}` | `/units/${string}`
  units: UnitOption[]
  tenants: Array<{ id: string; label: string }>
  defaults?: {
    id?: string
    unitId?: string
    tenantId?: string
    startDate?: string
    endDate?: string | null
    rentCents?: number
    depositCents?: number
    billingDay?: number
  }
}) {
  const [state, formAction] = useActionState<LeaseFormState, FormData>(action, {})

  const initialUnitId = defaults?.unitId ?? units[0]?.id ?? ''
  const [unitId, setUnitId] = useState(initialUnitId)
  const selectedUnit = units.find((unit) => unit.id === unitId) ?? null

  /**
   * Picking a unit fills in its default rent — but only while creating, and
   * only if the field has not been touched. Overwriting a rent someone typed,
   * or the rent already agreed on an existing lease, would be worse than a
   * blank field.
   */
  const [rent, setRent] = useState(
    defaults?.rentCents === undefined
      ? centsToInput(units.find((unit) => unit.id === initialUnitId)?.baseRentCents)
      : centsToInput(defaults.rentCents),
  )
  const [rentTouched, setRentTouched] = useState(defaults?.rentCents !== undefined)

  function onUnitChange(nextId: string) {
    setUnitId(nextId)
    if (rentTouched) return
    setRent(centsToInput(units.find((unit) => unit.id === nextId)?.baseRentCents))
  }

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {defaults?.id ? <input type="hidden" name="id" value={defaults.id} /> : null}

      <div className="space-y-1.5">
        <Label htmlFor="unitId">Unit</Label>
        <select
          id="unitId"
          name="unitId"
          className={selectClasses}
          value={unitId}
          onChange={(event) => onUnitChange(event.target.value)}
          required
        >
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.label}
              {unit.status === 'occupied' ? ' — occupied' : ''}
            </option>
          ))}
        </select>
        {selectedUnit?.status === 'occupied' ? (
          <p className="text-xs text-warning-foreground">
            This unit is occupied today. Unless the new term starts after the current lease ends,
            saving will be refused.
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tenantId">Resident</Label>
        <select
          id="tenantId"
          name="tenantId"
          className={selectClasses}
          defaultValue={defaults?.tenantId ?? tenants[0]?.id ?? ''}
          required
        >
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="startDate">Start date</Label>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={defaults?.startDate}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="endDate">End date</Label>
          <Input id="endDate" name="endDate" type="date" defaultValue={defaults?.endDate ?? ''} />
          <p className="text-xs text-muted-foreground">Leave blank for an open-ended lease.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rent">Monthly rent</Label>
          <Input
            id="rent"
            name="rent"
            inputMode="decimal"
            value={rent}
            onChange={(event) => {
              setRentTouched(true)
              setRent(event.target.value)
            }}
            placeholder="1200.00"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="deposit">Deposit</Label>
          <Input
            id="deposit"
            name="deposit"
            inputMode="decimal"
            defaultValue={centsToInput(defaults?.depositCents ?? 0)}
            placeholder="1200.00"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="billingDay">Billing day</Label>
        <Input
          id="billingDay"
          name="billingDay"
          type="number"
          min={MIN_BILLING_DAY}
          max={MAX_BILLING_DAY}
          defaultValue={defaults?.billingDay ?? 1}
          required
          className="max-w-24"
        />
        <p className="text-xs text-muted-foreground">
          The day of the month rent falls due. It stops at {MAX_BILLING_DAY} so the day exists in
          February too.
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

function centsToInput(cents: number | undefined): string {
  return cents === undefined ? '' : (cents / 100).toFixed(2)
}
