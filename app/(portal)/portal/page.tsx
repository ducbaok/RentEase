import type { Metadata } from 'next'
import { requireTenant } from '@/lib/auth'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/ui/empty-state'

export const metadata: Metadata = { title: 'Your home' }

/**
 * Built in Batch 2 (stream 2A): this month's invoice with its arithmetic, every
 * previous month, and a button to report a problem with a photo.
 */
export default async function PortalHomePage() {
  const identity = await requireTenant()

  return (
    <>
      <PageHeader
        title={`Hello, ${identity.fullName}`}
        description="Your invoices and repair requests will appear here."
      />
      <EmptyState
        title="Arrives in Batch 2 · stream 2A"
        description="This month's invoice showing exactly how it was calculated, your payment history, and a way to report a problem with a photo."
      />
    </>
  )
}
