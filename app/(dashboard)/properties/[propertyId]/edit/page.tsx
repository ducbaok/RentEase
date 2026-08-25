import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireOperator } from '@/lib/auth'
import { getProperty } from '@/lib/data/properties'
import { listUnits } from '@/lib/data/units'
import { PageHeader } from '@/components/shared/page-header'
import { PropertyForm } from '../../property-form'
import { DangerZone } from '../../_shared/danger-zone'
import { deletePropertyAction, updatePropertyAction } from '../../actions'

export const metadata: Metadata = { title: 'Edit property' }

export default async function EditPropertyPage({
  params,
}: {
  params: Promise<{ propertyId: string }>
}) {
  const { propertyId } = await params
  const { orgId } = await requireOperator()

  const property = await getProperty(orgId, propertyId)
  if (!property) notFound()

  // Deleting a property cascades through its units to their leases, invoices
  // and payments, so the button is closed off before it is ever pressed rather
  // than failing afterwards.
  const units = await listUnits(orgId, { propertyId })

  return (
    <>
      <PageHeader title={`Edit ${property.name}`} description="Rename it or correct the address." />

      <PropertyForm
        action={updatePropertyAction}
        submitLabel="Save changes"
        cancelHref={`/properties/${property.id}`}
        defaults={{ id: property.id, name: property.name, address: property.address }}
      />

      <DangerZone
        action={deletePropertyAction}
        id={property.id}
        title="Delete this property"
        description="Removing a property removes everything filed under it. It is only possible while it holds no units."
        buttonLabel="Delete property"
        confirmLabel="Yes, delete it"
        blockedReason={
          units.length > 0
            ? `This property still holds ${units.length} unit${units.length === 1 ? '' : 's'}. Delete those first — leases, invoices and payments hang off them.`
            : null
        }
      />
    </>
  )
}
