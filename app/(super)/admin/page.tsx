import type { Metadata } from 'next'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/ui/empty-state'

export const metadata: Metadata = { title: 'Admin' }

export default function AdminHomePage() {
  return (
    <>
      <PageHeader title="Organizations" description="Every account on RentEase." />
      <EmptyState
        title="Arrives in Batch 3 · stream 3B"
        description="The list of organizations with their plan, unit count and subscription state."
      />
    </>
  )
}
