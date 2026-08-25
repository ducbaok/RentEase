import type { Metadata } from 'next'
import Link from 'next/link'
import { DoorOpen } from 'lucide-react'
import { requireOperator } from '@/lib/auth'
import { listUnits } from '@/lib/data/units'
import { listPropertyOptions } from '@/lib/data/properties'
import { occupancySummary } from '@/lib/domain/leases'
import { formatCents } from '@/lib/domain/money'
import { PageHeader } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export const metadata: Metadata = { title: 'Units' }

/**
 * Every unit across every property, with the occupancy rate above it.
 *
 * AC1.1 lives on this screen for now: the rate is computed from the unit rows
 * on each render, so a lease created or ended a second ago is already counted.
 * Stream 2B puts the same number — from the same `occupancySummary` — on the
 * dashboard card in Batch 2.
 */
export default async function UnitsPage() {
  const { orgId } = await requireOperator()
  const [units, properties] = await Promise.all([
    listUnits(orgId),
    listPropertyOptions(orgId),
  ])
  const occupancy = occupancySummary(units)

  return (
    <>
      <PageHeader
        title="Units"
        description="Every unit across your properties."
        actions={
          properties.length > 0 && units.length > 0 ? (
            <Button asChild>
              <Link href="/units/new">Add unit</Link>
            </Button>
          ) : null
        }
      />

      {units.length > 0 ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Occupancy</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="tabular text-2xl font-semibold" data-testid="occupancy-percent">
                {occupancy.percent}%
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {occupancy.occupied} of {occupancy.total} units let
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Occupied</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="tabular text-2xl font-semibold" data-testid="occupancy-occupied">
                {occupancy.occupied}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Vacant</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="tabular text-2xl font-semibold" data-testid="occupancy-vacant">
                {occupancy.vacant}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {units.length === 0 ? (
        <EmptyState
          icon={DoorOpen}
          title={properties.length === 0 ? 'Add a property first' : 'No units yet'}
          description={
            properties.length === 0
              ? 'Units live inside a property, so the building comes first. It takes about ten seconds.'
              : 'Add the units you rent out. Occupancy, meter readings and invoices all follow from this list.'
          }
          action={
            properties.length === 0 ? (
              <Button asChild>
                <Link href="/properties/new">Add a property</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/units/new">Add your first unit</Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
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
                  <TableCell className="text-muted-foreground">
                    <Link href={`/properties/${unit.propertyId}`} className="hover:underline">
                      {unit.propertyName}
                    </Link>
                  </TableCell>
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
                  <TableCell className="tabular text-right">{unit.area ?? '—'}</TableCell>
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
