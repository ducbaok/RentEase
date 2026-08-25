import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOperator } from '@/lib/auth'
import { getTenant } from '@/lib/data/tenants'
import { formatTerm } from '@/lib/domain/leases'
import { formatCents } from '@/lib/domain/money'
import { PageHeader } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export const metadata: Metadata = { title: 'Resident' }

export default async function TenantPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params
  const { orgId } = await requireOperator()

  const tenant = await getTenant(orgId, tenantId)
  if (!tenant) notFound()

  return (
    <>
      <PageHeader
        title={tenant.fullName}
        description={
          tenant.currentUnit ? `Currently in ${tenant.currentUnit.label}.` : 'Not on a live lease.'
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/tenants/${tenant.id}/edit`}>Edit</Link>
            </Button>
            <Button asChild>
              <Link href={`/leases/new?tenantId=${tenant.id}`}>Start a lease</Link>
            </Button>
          </>
        }
      />

      <dl className="mb-8 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Email</dt>
          <dd className="mt-1 text-sm">{tenant.email ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Phone</dt>
          <dd className="mt-1 text-sm">{tenant.phone ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Portal account</dt>
          <dd className="mt-1">
            {tenant.hasPortalAccount ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="secondary">Not invited yet</Badge>
            )}
          </dd>
        </div>
      </dl>

      <h2 className="mb-3 text-sm font-semibold">Leases</h2>

      {tenant.leases.length === 0 ? (
        <EmptyState
          title="No lease yet"
          description="Attach this resident to a unit with dates, rent, deposit and a billing day. That lease is what invoices are issued against."
          action={
            <Button asChild>
              <Link href={`/leases/new?tenantId=${tenant.id}`}>Start a lease</Link>
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit</TableHead>
                <TableHead>Term</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Rent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenant.leases.map((lease) => (
                <TableRow key={lease.id}>
                  <TableCell className="font-medium">
                    <Link href={`/leases/${lease.id}`} className="hover:underline">
                      {lease.unitLabel}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatTerm({ startDate: lease.startDate, endDate: lease.endDate })}
                  </TableCell>
                  <TableCell>
                    {lease.occupiesToday ? (
                      <Badge variant="success">Current</Badge>
                    ) : lease.status === 'ended' ? (
                      <Badge variant="secondary">Ended</Badge>
                    ) : (
                      <Badge variant="outline">Not current</Badge>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {formatCents(lease.rentCents)}
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
