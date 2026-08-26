import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/lib/auth'
import { getMyRequest } from '@/lib/data/maintenance'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { RequestDetail } from '@/app/(dashboard)/maintenance/_components/request-detail'

export const metadata: Metadata = { title: 'Your request' }

export default async function PortalRequestPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireTenant()
  const { id } = await params
  const request = await getMyRequest(id)
  if (!request) notFound()

  return (
    <>
      <PageHeader
        title="Your request"
        description="Your landlord is notified each time this changes."
        actions={
          <Button asChild variant="outline">
            <Link href="/portal/maintenance">Back</Link>
          </Button>
        }
      />
      <RequestDetail request={request} />
    </>
  )
}
