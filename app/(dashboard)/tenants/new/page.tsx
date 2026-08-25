import type { Metadata } from 'next'
import { requireOperator } from '@/lib/auth'
import { PageHeader } from '@/components/shared/page-header'
import { TenantForm } from '../tenant-form'
import { createTenantAction } from '../actions'

export const metadata: Metadata = { title: 'Add resident' }

export default async function NewTenantPage() {
  await requireOperator()

  return (
    <>
      <PageHeader
        title="Add resident"
        description="Who they are and how to reach them. The lease comes next."
      />
      <TenantForm
        action={createTenantAction}
        submitLabel="Create resident"
        cancelHref="/tenants"
      />
    </>
  )
}
