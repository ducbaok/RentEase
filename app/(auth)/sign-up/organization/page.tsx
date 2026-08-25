import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getIdentity, homePathFor } from '@/lib/auth'
import { OrganizationForm } from './organization-form'

export const metadata: Metadata = { title: 'Name your business' }

/**
 * The second half of signing up.
 *
 * A brand-new account exists in Auth but owns nothing yet, so it has no
 * identity under RLS. This page is that gap, and it is the only place that
 * state is allowed to persist.
 */
export default async function CreateOrganizationPage() {
  const identity = await getIdentity()
  if (identity.kind !== 'unaffiliated') redirect(homePathFor(identity))

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Name your business</h1>
        <p className="text-sm text-muted-foreground">
          This is what residents see on their invoices. You can change it later.
        </p>
      </div>
      <OrganizationForm />
    </div>
  )
}
