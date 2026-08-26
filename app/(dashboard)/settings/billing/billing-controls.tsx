'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PLANS, PLAN_IDS, type PlanId } from '@/lib/domain/plan-limits'
import { openPortalAction, startCheckoutAction, type BillingFormState } from './actions'

/**
 * The plan cards and the portal button.
 *
 * A client component only because the two actions need their pending and error
 * states rendered next to the button that was pressed — the numbers and the
 * decisions all come from the server. Nothing here decides anything; a disabled
 * button is a courtesy and the action checks again regardless.
 */

function SubmitButton({
  label,
  pendingLabel,
  variant,
  disabled,
}: {
  label: string
  pendingLabel: string
  variant?: 'default' | 'outline'
  disabled?: boolean
}) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant={variant} disabled={pending || disabled} className="w-full">
      {pending ? pendingLabel : label}
    </Button>
  )
}

function priceLabel(plan: PlanId): string {
  return `$${(PLANS[plan].priceCents / 100).toFixed(0)}`
}

function allowanceLabel(plan: PlanId): string {
  const limit = PLANS[plan].unitLimit
  return limit === null ? 'Unlimited units' : `Up to ${limit} units`
}

export function BillingControls({
  currentPlan,
  subscribed,
  hasBillingAccount,
  stripeConfigured,
  unitCount,
}: {
  /** The plan on the subscription row, whether or not it is being paid for. */
  currentPlan: PlanId
  /**
   * Whether that plan is actually being paid for.
   *
   * Every organization carries plan 'mini' from the moment it signs up — it is
   * the column default — so the plan alone says nothing about whether anyone
   * chose it. Marking it "current" during a trial, or after one has expired,
   * offers a landlord who has never paid us a button reading "Stay on Mini",
   * which is both wrong and the opposite of what they need to do next.
   */
  subscribed: boolean
  /** True once a checkout has completed and Stripe knows this organization. */
  hasBillingAccount: boolean
  stripeConfigured: boolean
  unitCount: number
}) {
  const [checkoutState, checkoutAction] = useActionState<BillingFormState, FormData>(
    startCheckoutAction,
    {},
  )
  const [portalState, portalAction] = useActionState<BillingFormState, FormData>(
    openPortalAction,
    {},
  )

  return (
    <div className="space-y-6">
      {checkoutState.error ? (
        <Alert variant="destructive">
          <AlertDescription>{checkoutState.error}</AlertDescription>
        </Alert>
      ) : null}
      {portalState.error ? (
        <Alert variant="destructive">
          <AlertDescription>{portalState.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {PLAN_IDS.map((plan) => {
          const spec = PLANS[plan]
          const isCurrent = subscribed && plan === currentPlan
          const tooSmall = spec.unitLimit !== null && unitCount > spec.unitLimit

          return (
            <Card key={plan} className={isCurrent ? 'border-primary' : undefined}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{spec.name}</CardTitle>
                  {isCurrent ? <Badge variant="outline">Current plan</Badge> : null}
                </div>
                <p className="text-2xl font-semibold tabular-nums">
                  {priceLabel(plan)}
                  <span className="text-sm font-normal text-muted-foreground">/month</span>
                </p>
                <p className="text-sm text-muted-foreground">{spec.blurb}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {spec.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>

                {tooSmall ? (
                  <p className="text-sm text-muted-foreground">
                    {allowanceLabel(plan)} — you have {unitCount}.
                  </p>
                ) : null}

                <form action={checkoutAction}>
                  <input type="hidden" name="plan" value={plan} />
                  <SubmitButton
                    label={isCurrent ? `Stay on ${spec.name}` : `Choose ${spec.name}`}
                    pendingLabel="Opening Stripe…"
                    variant={isCurrent ? 'outline' : 'default'}
                    disabled={!stripeConfigured || tooSmall}
                  />
                </form>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {hasBillingAccount ? (
        <form action={portalAction} className="max-w-xs">
          <SubmitButton
            label="Manage billing on Stripe"
            pendingLabel="Opening Stripe…"
            variant="outline"
            disabled={!stripeConfigured}
          />
          <p className="mt-2 text-sm text-muted-foreground">
            Change your card, switch plan or cancel. Cancelling stops future charges — it never
            removes anything you have already recorded.
          </p>
        </form>
      ) : null}
    </div>
  )
}
