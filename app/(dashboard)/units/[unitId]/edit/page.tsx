import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireOperator } from '@/lib/auth'
import { getUnit } from '@/lib/data/units'
import { listPropertyOptions } from '@/lib/data/properties'
import { PageHeader } from '@/components/shared/page-header'
import { UnitForm } from '../../unit-form'
import { DangerZone } from '../../../properties/_shared/danger-zone'
import { deleteUnitAction, updateUnitAction } from '../../actions'

export const metadata: Metadata = { title: 'Edit unit' }

export default async function EditUnitPage({ params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params
  const { orgId } = await requireOperator()

  const [unit, properties] = await Promise.all([
    getUnit(orgId, unitId),
    listPropertyOptions(orgId),
  ])
  if (!unit) notFound()

  return (
    <>
      <PageHeader
        title={`Edit ${unit.propertyName} · ${unit.code}`}
        description="Correct the code, size or default rent."
      />

      <UnitForm
        action={updateUnitAction}
        submitLabel="Save changes"
        cancelHref={`/units/${unit.id}`}
        properties={properties}
        defaults={{
          id: unit.id,
          propertyId: unit.propertyId,
          code: unit.code,
          area: unit.area,
          baseRentCents: unit.baseRentCents,
          status: unit.status,
        }}
        statusLockedBy={
          unit.currentLease ? { tenantName: unit.currentLease.tenantName } : null
        }
      />

      <DangerZone
        action={deleteUnitAction}
        id={unit.id}
        title="Delete this unit"
        description="Only possible while no lease has ever been recorded against it — a lease carries the invoices and payments with it."
        buttonLabel="Delete unit"
        confirmLabel="Yes, delete it"
        blockedReason={
          unit.leases.length > 0
            ? `This unit has ${unit.leases.length} lease${unit.leases.length === 1 ? '' : 's'} on record, so its billing history would go with it.`
            : null
        }
      />
    </>
  )
}
