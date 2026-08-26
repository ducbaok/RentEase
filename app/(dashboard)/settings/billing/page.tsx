import type { Metadata } from 'next'
import { PageHeader } from '@/components/shared/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { decideCreate, PLANS } from '@/lib/domain/plan-limits'
import { loadBillingSnapshot } from '@/lib/stripe/entitlement'
import { isStripeConfigured, isTestMode } from '@/lib/stripe/client'
import { formatDateTime } from '../../invoices/_components/format'
import { BillingControls } from './billing-controls'
import { RefreshFromStripe } from './refresh-button'

export const metadata: Metadata = { title: 'Plan & billing' }

/**
 * Plan & billing (AC-S2, AC-S3).
 *
 * OWNERS ONLY, AND POLITELY. A manager reaching this page is not shown a
 * broken screen or a Postgres error: RLS returns them no subscription row at
 * all — that is the rule (migration 0700, "a manager runs the buildings, not
 * the billing relationship") — and the page says so in a sentence. Guessing
 * that an empty result meant "no subscription" and rendering the plan cards is
 * the failure mode this exists to avoid: the manager would then press a button
 * that could only fail.
 *
 * WHAT A REFUSAL LOOKS LIKE HERE. Over the unit allowance, or out of trial,
 * this page shows an offer with a price on it — not a lock screen. The rest of
 * the application is untouched in both states, which is the literal promise of
 * AC-S2 and AC-S3 and is why the banner says so out loud rather than leaving a
 * landlord to discover whether their data still works.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>
}) {
  const [snapshot, params] = await Promise.all([loadBillingSnapshot(), searchParams])

  if (snapshot.role !== 'owner') {
    return (
      <>
        <PageHeader title="Plan & billing" description="Your RentEase subscription." />
        <EmptyState
          title="Only the account owner can see billing"
          description={`Your account manages the buildings for ${snapshot.orgName} — plans, invoices from RentEase and payment details belong to the owner. Everything else you use is unaffected.`}
        />
      </>
    )
  }

  const subscription = snapshot.subscription
  const entitlement = snapshot.entitlement
  const plan = subscription?.plan ?? 'mini'
  const spec = PLANS[plan]

  // The same rule the create actions run, asked here so the page and the button
  // can never disagree about whether the next unit is allowed.
  const nextUnit = subscription
    ? decideCreate({ subscription, unitCount: snapshot.unitCount, kind: 'unit' })
    : null

  const limit = entitlement.unitLimit
  const usage =
    limit === null
      ? `${snapshot.unitCount} ${snapshot.unitCount === 1 ? 'unit' : 'units'} · no limit`
      : `${snapshot.unitCount} of ${limit} units used`

  return (
    <>
      <PageHeader
        title="Plan & billing"
        description="Your RentEase subscription, priced by how many units you manage."
      />

      {params.checkout === 'success' ? (
        <Alert variant="success" className="mb-6">
          <AlertTitle>Thanks — your plan is being set up</AlertTitle>
          <AlertDescription>
            Stripe confirms subscriptions in the background and it usually lands within seconds. If
            the plan below still looks wrong, use “Refresh from Stripe”.
          </AlertDescription>
        </Alert>
      ) : null}

      {params.checkout === 'cancelled' ? (
        <Alert className="mb-6">
          <AlertTitle>Checkout cancelled</AlertTitle>
          <AlertDescription>Nothing was charged and nothing changed.</AlertDescription>
        </Alert>
      ) : null}

      {entitlement.code === 'trial_expired' || entitlement.code === 'inactive' ? (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>
            {entitlement.code === 'trial_expired'
              ? 'Your 14-day trial has ended'
              : 'This organization has no active subscription'}
          </AlertTitle>
          <AlertDescription>
            {nextUnit?.message ??
              'Choose a plan below to start adding new properties, units, residents and invoices again.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {entitlement.code === 'past_due' ? (
        <Alert variant="warning" className="mb-6">
          <AlertTitle>Your last payment did not go through</AlertTitle>
          <AlertDescription>
            Stripe is retrying the card. Nothing is blocked in the meantime — update your card in
            the billing portal to be sure it goes through.
          </AlertDescription>
        </Alert>
      ) : null}

      {nextUnit && nextUnit.code === 'unit_limit' ? (
        <Alert variant="warning" className="mb-6">
          <AlertTitle>You have reached the units your plan covers</AlertTitle>
          <AlertDescription>{nextUnit.message}</AlertDescription>
        </Alert>
      ) : null}

      {!isStripeConfigured() ? (
        <Alert className="mb-6">
          <AlertTitle>Billing is not connected on this server</AlertTitle>
          <AlertDescription>
            No Stripe key is configured here, so checkout and the billing portal are unavailable.
            Everything else in RentEase works exactly as normal, including your trial.
          </AlertDescription>
        </Alert>
      ) : isTestMode() ? (
        <Alert className="mb-6">
          <AlertTitle>Stripe test mode</AlertTitle>
          <AlertDescription>
            This server is connected to Stripe in test mode. No real card is charged and no real
            money moves.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-6">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Current plan</CardTitle>
            <StatusBadge code={entitlement.code} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {subscription ? (
            <>
              <dl className="grid gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-sm text-muted-foreground">Plan</dt>
                  <dd className="text-sm font-medium">
                    {spec.name} · ${(spec.priceCents / 100).toFixed(0)}/month
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Units</dt>
                  <dd className="text-sm font-medium tabular-nums">{usage}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">
                    {entitlement.code === 'trialing'
                      ? 'Trial ends'
                      : entitlement.code === 'trial_expired'
                        ? 'Trial ended'
                        : 'Current period ends'}
                  </dt>
                  <dd className="text-sm font-medium">
                    {subscription.periodEnd ? formatDateTime(subscription.periodEnd) : '—'}
                  </dd>
                </div>
              </dl>

              {entitlement.code === 'trialing' ? (
                <p className="text-sm text-muted-foreground">
                  {entitlement.trialDaysLeft === null
                    ? 'You are on the free trial. No card needed.'
                    : `${entitlement.trialDaysLeft} ${entitlement.trialDaysLeft === 1 ? 'day' : 'days'} left in your free trial — no card needed, and every feature is switched on.`}
                </p>
              ) : null}

              <RefreshFromStripe disabled={!isStripeConfigured()} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              We could not read your subscription just now. Nothing is blocked — try again in a
              moment.
            </p>
          )}
        </CardContent>
      </Card>

      <BillingControls
        currentPlan={plan}
        subscribed={entitlement.code === 'active' || entitlement.code === 'past_due'}
        hasBillingAccount={Boolean(subscription?.stripeCustomerId)}
        stripeConfigured={isStripeConfigured()}
        unitCount={snapshot.unitCount}
      />
    </>
  )
}

function StatusBadge({ code }: { code: string }) {
  switch (code) {
    case 'trialing':
      return <Badge variant="secondary">Free trial</Badge>
    case 'active':
      return <Badge variant="success">Active</Badge>
    case 'past_due':
      return <Badge variant="warning">Payment failed</Badge>
    case 'trial_expired':
      return <Badge variant="destructive">Trial ended</Badge>
    default:
      return <Badge variant="destructive">Not subscribed</Badge>
  }
}
