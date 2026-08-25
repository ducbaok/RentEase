import type { Metadata } from 'next'
import Link from 'next/link'
import { requireOperator } from '@/lib/auth'
import { listPropertyOptions } from '@/lib/data/properties'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { UnitForm } from '../unit-form'
import { createUnitAction } from '../actions'

export const metadata: Metadata = { title: 'Add unit' }

export default async function NewUnitPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string }>
}) {
  const { orgId } = await requireOperator()
  const { propertyId } = await searchParams
  const properties = await listPropertyOptions(orgId)

  if (properties.length === 0) {
    return (
      <>
        <PageHeader title="Add unit" description="Units live inside a property." />
        <EmptyState
          title="There is no property to put this in yet"
          description="Create the building first, then come back and add its units."
          action={
            <Button asChild>
              <Link href="/properties/new">Add a property</Link>
            </Button>
          }
        />
      </>
    )
  }

  // A property id in the URL only pre-selects the picker. It is never trusted:
  // the action re-reads it from the form and the insert policy checks the
  // organization, so a guessed id belonging to another landlord is refused.
  return (
    <>
      <PageHeader
        title="Add unit"
        description="A rentable space: an apartment, a room, a shop front."
      />
      <UnitForm
        action={createUnitAction}
        submitLabel="Create unit"
        cancelHref={propertyId ? `/properties/${propertyId}` : '/units'}
        properties={properties}
        defaults={{ propertyId }}
      />
    </>
  )
}
