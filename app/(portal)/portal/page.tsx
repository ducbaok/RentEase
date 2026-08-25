import type { Metadata } from 'next'
import Link from 'next/link'
import type { Route } from 'next'
import { requireTenant } from '@/lib/auth'
import { getPortalInvoices } from '@/lib/data/portal'
import { formatCents } from '@/lib/domain/money'
import { outstandingCents } from '@/lib/domain/invoice-status'
import { formatPeriod, type Period } from '@/lib/domain/period'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { InvoiceStatusBadge } from '@/app/(dashboard)/invoices/_components/invoice-status-badge'
import { formatDate } from '@/app/(dashboard)/invoices/_components/format'

export const metadata: Metadata = { title: 'Your home' }

/**
 * The resident's home: this month's bill and every earlier one, each opening to
 * the exact working the landlord sees (AC7.2), plus a way to report a repair.
 */
export default async function PortalHomePage() {
  const identity = await requireTenant()
  const invoices = await getPortalInvoices()

  return (
    <>
      <PageHeader
        title={`Hello, ${identity.fullName}`}
        description="Your rent and utility bills, and anything you've reported."
        actions={
          <Button asChild variant="outline">
            <Link href="/portal/maintenance">Report a problem</Link>
          </Button>
        }
      />

      {invoices.length === 0 ? (
        <EmptyState
          title="No bills yet"
          description="When your landlord issues a bill, it will appear here with a full breakdown of how it was worked out."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>
                    <Link
                      href={`/portal/invoices/${invoice.id}` as Route}
                      className="font-medium text-primary hover:underline"
                    >
                      {formatPeriod(invoice.period as Period)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{invoice.unitCode}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(invoice.dueDate)}</TableCell>
                  <TableCell>
                    <InvoiceStatusBadge status={invoice.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(invoice.totalCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(outstandingCents(invoice.totalCents, invoice.paidCents))}
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
