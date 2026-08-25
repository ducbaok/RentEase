import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireOperator } from '@/lib/auth'
import { getUnit, type UnitDetail } from '@/lib/data/units'
import { formatTerm, todayIso } from '@/lib/domain/leases'
import { formatCents } from '@/lib/domain/money'
import { PageHeader } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export const metadata: Metadata = { title: 'Unit' }

/**
 * An 'active' lease is not automatically the current one: it may not have begun
 * yet, or its end date may have gone by without anyone closing it. Naming those
 * two apart is what stops a landlord staring at a vacant unit that appears to
 * have a live lease on it.
 */
function leaseState(lease: UnitDetail['leases'][number], today: string) {
  if (lease.occupiesToday) return { label: 'Current', variant: 'success' as const }
  if (lease.status === 'ended') return { label: 'Ended', variant: 'secondary' as const }
  if (lease.startDate > today) return { label: 'Upcoming', variant: 'outline' as const }
  return { label: 'Past end date', variant: 'warning' as const }
}

export default async function UnitPage({ params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params
  const { orgId } = await requireOperator()

  const unit = await getUnit(orgId, unitId)
  if (!unit) notFound()

  const today = todayIso()

  return (
    <>
      <PageHeader
        title={`${unit.propertyName} · ${unit.code}`}
        description={
          unit.currentLease
            ? `Let to ${unit.currentLease.tenantName}.`
            : 'Vacant — no lease covers today.'
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/units/${unit.id}/edit`}>Edit</Link>
            </Button>
            {unit.currentLease ? (
              <Button asChild>
                <Link href={`/leases/${unit.currentLease.id}`}>Open lease</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href={`/leases/new?unitId=${unit.id}`}>Start a lease</Link>
              </Button>
            )}
          </>
        }
      />

      <dl className="mb-8 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Status</dt>
          <dd className="mt-1">
            <Badge variant={unit.status === 'occupied' ? 'success' : 'secondary'}>
              {unit.status === 'occupied' ? 'Occupied' : 'Vacant'}
            </Badge>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Default rent</dt>
          <dd className="tabular mt-1 text-sm">{formatCents(unit.baseRentCents)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Size</dt>
          <dd className="tabular mt-1 text-sm">{unit.area ?? '—'}</dd>
        </div>
      </dl>

      <h2 className="mb-3 text-sm font-semibold">Leases</h2>

      {unit.leases.length === 0 ? (
        <EmptyState
          title="No lease on this unit yet"
          description="A lease attaches a resident with dates, rent, deposit and a billing day — and it is what turns the unit occupied."
          action={
            <Button asChild>
              <Link href={`/leases/new?unitId=${unit.id}`}>Start a lease</Link>
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Resident</TableHead>
                <TableHead>Term</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Rent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unit.leases.map((lease) => (
                <TableRow key={lease.id}>
                  <TableCell className="font-medium">
                    <Link href={`/leases/${lease.id}`} className="hover:underline">
                      {lease.tenantName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatTerm({ startDate: lease.startDate, endDate: lease.endDate })}
                  </TableCell>
                  <TableCell>
                    <Badge variant={leaseState(lease, today).variant}>
                      {leaseState(lease, today).label}
                    </Badge>
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
