import type { Metadata } from 'next'
import { requireOperator } from '@/lib/auth'
import { PageHeader } from '@/components/shared/page-header'
import { PropertyForm } from '../property-form'
import { createPropertyAction } from '../actions'

export const metadata: Metadata = { title: 'Add property' }

export default async function NewPropertyPage() {
  await requireOperator()

  return (
    <>
      <PageHeader
        title="Add property"
        description="A building, a house, a duplex — whatever you rent out as one address."
      />
      <PropertyForm
        action={createPropertyAction}
        submitLabel="Create property"
        cancelHref="/properties"
      />
    </>
  )
}
