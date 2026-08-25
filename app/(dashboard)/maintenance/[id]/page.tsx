import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOperator } from '@/lib/auth'
import { getOrgRequest } from '@/lib/data/maintenance'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { RequestDetail } from '../_components/request-detail'
import { StatusControl } from '../_components/status-control'

export const metadata: Metadata = { title: 'Request' }

export default async function OperatorRequestPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireOperator()
  const { id } = await params
  const request = await getOrgRequest(id)
  if (!request) notFound()

  return (
    <>
      <PageHeader
        title="Request"
        description="Everything the resident reported."
        actions={
          <Button asChild variant="outline">
            <Link href="/maintenance">Back to maintenance</Link>
          </Button>
        }
      />
      <RequestDetail
        request={request}
        showTenant
        control={<StatusControl id={request.id} status={request.status} />}
      />
    </>
  )
}
