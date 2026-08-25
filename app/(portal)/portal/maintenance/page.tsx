import type { Metadata } from 'next'
import Link from 'next/link'
import type { Route } from 'next'
import { requireTenant } from '@/lib/auth'
import { listMyRequests } from '@/lib/data/maintenance'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/app/(dashboard)/invoices/_components/format'
import { MaintenanceStatusBadge } from '@/app/(dashboard)/maintenance/_components/status-badge'

export const metadata: Metadata = { title: 'Repairs' }

export default async function PortalMaintenancePage() {
  await requireTenant()
  const requests = await listMyRequests()

  return (
    <>
      <PageHeader
        title="Repairs"
        description="Problems you've reported and where each one stands."
        actions={
          <Button asChild>
            <Link href="/portal/maintenance/new">Report a problem</Link>
          </Button>
        }
      />

      {requests.length === 0 ? (
        <EmptyState
          title="Nothing reported yet"
          description="When something needs fixing, report it here and your landlord will be notified."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Problem</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Reported</TableHead>
                <TableHead>Photos</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>
                    <Link
                      href={`/portal/maintenance/${request.id}` as Route}
                      className="font-medium text-primary hover:underline"
                    >
                      {request.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{request.unitCode}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(request.createdAt.slice(0, 10))}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{request.photoCount}</TableCell>
                  <TableCell>
                    <MaintenanceStatusBadge status={request.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
