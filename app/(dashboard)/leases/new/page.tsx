import type { Metadata } from 'next'
import Link from 'next/link'
import { requireOperator } from '@/lib/auth'
import { listUnitOptions } from '@/lib/data/units'
import { listTenantOptions } from '@/lib/data/tenants'
import { todayIso } from '@/lib/domain/leases'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { LeaseForm } from '../lease-form'
import { createLeaseAction } from '../actions'

export const metadata: Metadata = { title: 'New lease' }

export default async function NewLeasePage({
  searchParams,
}: {
  searchParams: Promise<{ unitId?: string; tenantId?: string }>
}) {
  const { orgId } = await requireOperator()
  const { unitId, tenantId } = await searchParams
  const [units, tenants] = await Promise.all([listUnitOptions(orgId), listTenantOptions(orgId)])

  const missing = units.length === 0 ? 'unit' : tenants.length === 0 ? 'resident' : null
  if (missing) {
    return (
      <>
        <PageHeader title="New lease" description="A lease joins a resident to a unit." />
        <EmptyState
          title={`There is no ${missing} to put on a lease yet`}
          description={
            missing === 'unit'
              ? 'Add the property and the unit first — the lease needs somewhere to point.'
              : 'Add the resident first, then come back and give them the keys.'
          }
          action={
            <Button asChild>
              <Link href={missing === 'unit' ? '/units/new' : '/tenants/new'}>
                {missing === 'unit' ? 'Add a unit' : 'Add a resident'}
              </Link>
            </Button>
          }
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="New lease"
        description="Dates, rent, deposit and the day rent falls due each month."
      />
      <LeaseForm
        action={createLeaseAction}
        submitLabel="Create lease"
        cancelHref={unitId ? `/units/${unitId}` : '/leases'}
        units={units}
        tenants={tenants}
        defaults={{ unitId, tenantId, startDate: todayIso(), billingDay: 1 }}
      />
    </>
  )
}
