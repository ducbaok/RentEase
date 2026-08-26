import type { Metadata } from 'next'
import Link from 'next/link'
import { requireTenant } from '@/lib/auth'
import { getPortalUnits } from '@/lib/data/maintenance'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { NewRequestForm } from '../new-request-form'

export const metadata: Metadata = { title: 'Report a problem' }

export default async function NewRequestPage() {
  await requireTenant()
  const units = await getPortalUnits()

  return (
    <>
      <PageHeader
        title="Report a problem"
        description="Tell your landlord what needs fixing. You can add photos."
        actions={
          <Button asChild variant="outline">
            <Link href="/portal/maintenance">Back</Link>
          </Button>
        }
      />
      {units.length === 0 ? (
        <EmptyState
          title="No active lease"
          description="You need an active lease to report a repair. If this looks wrong, contact your landlord."
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <NewRequestForm units={units} />
          </CardContent>
        </Card>
      )}
    </>
  )
}
