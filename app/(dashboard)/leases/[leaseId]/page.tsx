import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOperator } from '@/lib/auth'
import { getLease } from '@/lib/data/leases'
import { formatIsoDate, formatTerm, todayIso } from '@/lib/domain/leases'
import { formatCents } from '@/lib/domain/money'
import { PageHeader } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EndLeaseForm } from '../end-lease-form'

export const metadata: Metadata = { title: 'Lease' }

export default async function LeasePage({ params }: { params: Promise<{ leaseId: string }> }) {
  const { leaseId } = await params
  const { orgId } = await requireOperator()

  const lease = await getLease(orgId, leaseId)
  if (!lease) notFound()

  const today = todayIso()

  return (
    <>
      <PageHeader
        title={`${lease.unitLabel} · ${lease.tenantName}`}
        description={formatTerm({ startDate: lease.startDate, endDate: lease.endDate })}
        actions={
          lease.status === 'active' ? (
            <Button variant="outline" asChild>
              <Link href={`/leases/${lease.id}/edit`}>Edit</Link>
            </Button>
          ) : null
        }
      />

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">State</dt>
          <dd className="mt-1">
            {lease.occupiesToday ? (
              <Badge variant="success">Current</Badge>
            ) : lease.status === 'ended' ? (
              <Badge variant="secondary">Ended</Badge>
            ) : lease.startDate > today ? (
              <Badge variant="outline">Starts {formatIsoDate(lease.startDate)}</Badge>
            ) : (
              <Badge variant="warning">Past end date</Badge>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Monthly rent</dt>
          <dd className="tabular mt-1 text-sm">{formatCents(lease.rentCents)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Deposit</dt>
          <dd className="tabular mt-1 text-sm">{formatCents(lease.depositCents)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Rent due on</dt>
          <dd className="tabular mt-1 text-sm">Day {lease.billingDay} of the month</dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-wrap gap-4 text-sm">
        <Link href={`/units/${lease.unitId}`} className="text-primary hover:underline">
          Open unit
        </Link>
        <Link href={`/tenants/${lease.tenantId}`} className="text-primary hover:underline">
          Open resident
        </Link>
      </div>

      {lease.status === 'active' ? (
        <EndLeaseForm leaseId={lease.id} today={today} />
      ) : (
        <p className="mt-8 rounded-lg border border-border p-4 text-sm text-muted-foreground">
          This lease ended on {lease.endDate ? formatIsoDate(lease.endDate) : 'an unrecorded date'}.
          The unit is free for a new lease, and the invoices issued under this one are untouched.
        </p>
      )}
    </>
  )
}
