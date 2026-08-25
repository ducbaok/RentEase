import type { Metadata } from 'next'
import Link from 'next/link'
import type { Route } from 'next'
import { requireOperator } from '@/lib/auth'
import { listOrgRequests } from '@/lib/data/maintenance'
import {
  MAINTENANCE_STATUS_LABELS,
  MAINTENANCE_STATUS_ORDER,
  type MaintenanceStatus,
} from '@/lib/data/maintenance-status'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/app/(dashboard)/invoices/_components/format'
import { MaintenanceStatusBadge } from './_components/status-badge'

export const metadata: Metadata = { title: 'Maintenance' }

function isStatus(value: string | undefined): value is MaintenanceStatus {
  return value === 'submitted' || value === 'in_progress' || value === 'done'
}

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  await requireOperator()
  const { status } = await searchParams
  const filter = isStatus(status) ? status : undefined
  const requests = await listOrgRequests(filter)

  const tabs: Array<{ key: MaintenanceStatus | 'all'; label: string; href: Route }> = [
    { key: 'all', label: 'All', href: '/maintenance' },
    ...MAINTENANCE_STATUS_ORDER.map((s) => ({
      key: s,
      label: MAINTENANCE_STATUS_LABELS[s],
      href: `/maintenance?status=${s}` as Route,
    })),
  ]
  const active: MaintenanceStatus | 'all' = filter ?? 'all'

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Problems residents have reported. Move one forward and the resident is emailed."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              active === tab.key
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {requests.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description={
            filter
              ? 'No requests with this status.'
              : 'When a resident reports a problem, it will appear here.'
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Problem</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Resident</TableHead>
                <TableHead>Reported</TableHead>
                <TableHead>Photos</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => (
                <TableRow key={request.id} data-unit={request.unitCode}>
                  <TableCell>
                    <Link
                      href={`/maintenance/${request.id}` as Route}
                      className="font-medium text-primary hover:underline"
                    >
                      {request.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{request.unitCode}</TableCell>
                  <TableCell className="text-muted-foreground">{request.tenantName}</TableCell>
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
