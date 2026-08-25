import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireOperator } from '@/lib/auth'
import { getTenant } from '@/lib/data/tenants'
import { PageHeader } from '@/components/shared/page-header'
import { TenantForm } from '../../tenant-form'
import { DangerZone } from '../../../properties/_shared/danger-zone'
import { deleteTenantAction, updateTenantAction } from '../../actions'

export const metadata: Metadata = { title: 'Edit resident' }

export default async function EditTenantPage({
  params,
}: {
  params: Promise<{ tenantId: string }>
}) {
  const { tenantId } = await params
  const { orgId } = await requireOperator()

  const tenant = await getTenant(orgId, tenantId)
  if (!tenant) notFound()

  return (
    <>
      <PageHeader title={`Edit ${tenant.fullName}`} description="Correct their contact details." />

      <TenantForm
        action={updateTenantAction}
        submitLabel="Save changes"
        cancelHref={`/tenants/${tenant.id}`}
        defaults={{
          id: tenant.id,
          fullName: tenant.fullName,
          email: tenant.email,
          phone: tenant.phone,
        }}
      />

      <DangerZone
        action={deleteTenantAction}
        id={tenant.id}
        title="Delete this resident"
        description="Only possible while no lease names them — the database refuses it otherwise, because their invoices hang off the lease."
        buttonLabel="Delete resident"
        confirmLabel="Yes, delete them"
        blockedReason={
          tenant.leaseCount > 0
            ? `${tenant.fullName} is named on ${tenant.leaseCount} lease${tenant.leaseCount === 1 ? '' : 's'}. Remove those first.`
            : null
        }
      />
    </>
  )
}
