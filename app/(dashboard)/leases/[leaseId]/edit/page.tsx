import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireOperator } from '@/lib/auth'
import { getLease } from '@/lib/data/leases'
import { listUnitOptions } from '@/lib/data/units'
import { listTenantOptions } from '@/lib/data/tenants'
import { PageHeader } from '@/components/shared/page-header'
import { LeaseForm } from '../../lease-form'
import { DangerZone } from '../../../properties/_shared/danger-zone'
import { deleteLeaseAction, updateLeaseAction } from '../../actions'

export const metadata: Metadata = { title: 'Edit lease' }

export default async function EditLeasePage({
  params,
}: {
  params: Promise<{ leaseId: string }>
}) {
  const { leaseId } = await params
  const { orgId } = await requireOperator()

  const [lease, units, tenants] = await Promise.all([
    getLease(orgId, leaseId),
    listUnitOptions(orgId),
    listTenantOptions(orgId),
  ])
  if (!lease) notFound()

  return (
    <>
      <PageHeader
        title="Edit lease"
        description={`${lease.unitLabel} · ${lease.tenantName}. Changing the term is checked against the other leases on that unit.`}
      />

      <LeaseForm
        action={updateLeaseAction}
        submitLabel="Save changes"
        cancelHref={`/leases/${lease.id}`}
        units={units}
        tenants={tenants}
        defaults={{
          id: lease.id,
          unitId: lease.unitId,
          tenantId: lease.tenantId,
          startDate: lease.startDate,
          endDate: lease.endDate,
          rentCents: lease.rentCents,
          depositCents: lease.depositCents,
          billingDay: lease.billingDay,
        }}
      />

      <DangerZone
        action={deleteLeaseAction}
        id={lease.id}
        title="Delete this lease"
        description="For a lease entered by mistake. If the resident really lived here, end the lease instead — that keeps the history."
        buttonLabel="Delete lease"
        confirmLabel="Yes, delete it"
      />
    </>
  )
}
