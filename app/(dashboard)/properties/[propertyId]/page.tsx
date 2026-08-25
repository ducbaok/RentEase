import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DoorOpen } from 'lucide-react'
import { requireOperator } from '@/lib/auth'
import { getProperty } from '@/lib/data/properties'
import { listUnits } from '@/lib/data/units'
import { occupancySummary } from '@/lib/domain/leases'
import { formatCents } from '@/lib/domain/money'
import { PageHeader } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export const metadata: Metadata = { title: 'Property' }

export default async function PropertyPage({
  params,
}: {
  params: Promise<{ propertyId: string }>
}) {
  const { propertyId } = await params
  const { orgId } = await requireOperator()

  const property = await getProperty(orgId, propertyId)
  // Null here is the access rules working as much as it is a bad id: another
  // landlord's property simply does not exist as far as this session knows.
  if (!property) notFound()

  const units = await listUnits(orgId, { propertyId })
  const occupancy = occupancySummary(units)

  return (
    <>
      <PageHeader
        title={property.name}
        description={property.address ?? 'No address on file.'}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/properties/${property.id}/edit`}>Edit</Link>
            </Button>
            <Button asChild>
              <Link href={`/units/new?propertyId=${property.id}`}>Add unit</Link>
            </Button>
          </>
        }
      />

      <p className="mb-4 text-sm text-muted-foreground">
        <span className="tabular font-medium text-foreground">
          {occupancy.occupied} of {occupancy.total}
        </span>{' '}
        units occupied · <span className="tabular">{occupancy.percent}%</span>
      </p>

      {units.length === 0 ? (
        <EmptyState
          icon={DoorOpen}
          title="No units in this property yet"
          description="Add the units you rent out. Each one carries its own code, size and default rent, and that default becomes the rent on a new lease."
          action={
            <Button asChild>
              <Link href={`/units/new?propertyId=${property.id}`}>Add the first unit</Link>
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Resident</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">Default rent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.map((unit) => (
                <TableRow key={unit.id}>
                  <TableCell className="font-medium">
                    <Link href={`/units/${unit.id}`} className="hover:underline">
                      {unit.code}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={unit.status === 'occupied' ? 'success' : 'secondary'}>
                      {unit.status === 'occupied' ? 'Occupied' : 'Vacant'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {unit.currentLease ? (
                      <Link
                        href={`/tenants/${unit.currentLease.tenantId}`}
                        className="hover:underline"
                      >
                        {unit.currentLease.tenantName}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {unit.area ?? '—'}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {formatCents(unit.baseRentCents)}
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
