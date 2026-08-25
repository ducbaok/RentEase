import type { Metadata } from 'next'
import Link from 'next/link'
import { Users } from 'lucide-react'
import { requireOperator } from '@/lib/auth'
import { listTenants } from '@/lib/data/tenants'
import { PageHeader } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export const metadata: Metadata = { title: 'Residents' }

export default async function TenantsPage() {
  const { orgId } = await requireOperator()
  const tenants = await listTenants(orgId)

  return (
    <>
      <PageHeader
        title="Residents"
        description="The people renting from you."
        actions={
          tenants.length > 0 ? (
            <Button asChild>
              <Link href="/tenants/new">Add resident</Link>
            </Button>
          ) : null
        }
      />

      {tenants.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No residents yet"
          description="Add someone here, then put them on a lease. A resident can be billed long before they ever sign in to the portal, so an email address is optional for now."
          action={
            <Button asChild>
              <Link href="/tenants/new">Add your first resident</Link>
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Lives in</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Portal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell className="font-medium">
                    <Link href={`/tenants/${tenant.id}`} className="hover:underline">
                      {tenant.fullName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {tenant.currentUnit ? (
                      <Link href={`/units/${tenant.currentUnit.unitId}`} className="hover:underline">
                        {tenant.currentUnit.label}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{tenant.email ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{tenant.phone ?? '—'}</TableCell>
                  <TableCell>
                    {tenant.hasPortalAccount ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Not invited</Badge>
                    )}
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
