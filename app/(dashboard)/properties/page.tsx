import type { Metadata } from 'next'
import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { requireOperator } from '@/lib/auth'
import { listProperties } from '@/lib/data/properties'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export const metadata: Metadata = { title: 'Properties' }

export default async function PropertiesPage() {
  const { orgId } = await requireOperator()
  const properties = await listProperties(orgId)

  return (
    <>
      <PageHeader
        title="Properties"
        description="Your buildings and the units inside them."
        actions={
          properties.length > 0 ? (
            <Button asChild>
              <Link href="/properties/new">Add property</Link>
            </Button>
          ) : null
        }
      />

      {properties.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No properties yet"
          description="Start with the building. Units, residents and leases hang off it, and everything you bill for later is one of its units."
          action={
            <Button asChild>
              <Link href="/properties/new">Add your first property</Link>
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Address</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Occupied</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {properties.map((property) => (
                <TableRow key={property.id}>
                  <TableCell className="font-medium">
                    <Link href={`/properties/${property.id}`} className="hover:underline">
                      {property.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {property.address ?? '—'}
                  </TableCell>
                  <TableCell className="tabular text-right">{property.occupancy.total}</TableCell>
                  <TableCell className="tabular text-right">
                    {property.occupancy.occupied} / {property.occupancy.total}
                    <span className="ml-2 text-muted-foreground">
                      {property.occupancy.percent}%
                    </span>
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
