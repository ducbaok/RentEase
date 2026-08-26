import type { Metadata } from 'next'
import Link from 'next/link'
import type { Route } from 'next'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCents } from '@/lib/domain/money'
import { outstandingCents } from '@/lib/domain/invoice-status'
import { currentPeriod, formatPeriod, isPeriod, type Period } from '@/lib/domain/period'
import { listInvoicedPeriods, listInvoices } from '@/lib/data/invoices'
import { PeriodNav } from '../meters/period-nav'
import { InvoiceStatusBadge } from './_components/invoice-status-badge'
import { formatDate } from './_components/format'

export const metadata: Metadata = { title: 'Invoices' }

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const params = await searchParams
  const known = await listInvoicedPeriods()
  const fallback = known[0]
  const period: Period = isPeriod(params.period)
    ? params.period
    : isPeriod(fallback)
      ? fallback
      : currentPeriod()

  const invoices = await listInvoices({ period })

  const billed = invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0)
  const collected = invoices.reduce((sum, invoice) => sum + invoice.paidCents, 0)

  return (
    <>
      <PageHeader
        title="Invoices"
        description={`${formatPeriod(period)} — ${formatCents(collected)} of ${formatCents(billed)} collected.`}
        actions={
          <div className="flex items-center gap-2">
            <PeriodNav period={period} basePath="/invoices" />
            <Button asChild variant="outline">
              <Link href="/invoices/audit">Change history</Link>
            </Button>
            <Button asChild>
              <Link href={`/invoices/issue?period=${period}` as Route}>
                Issue invoices for {period}
              </Link>
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="pt-6">
          {invoices.length === 0 ? (
            <EmptyState
              title={`No invoices for ${formatPeriod(period)}`}
              description="Nothing has been billed for this month yet. Review what would be issued before anything is created."
              action={
                <Button asChild>
                  <Link href={`/invoices/issue?period=${period}` as Route}>Review and issue</Link>
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead>Resident</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/invoices/${invoice.id}` as Route}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {invoice.unitCode}
                      </Link>
                      <div className="text-xs text-muted-foreground">{invoice.propertyName}</div>
                    </TableCell>
                    <TableCell>{invoice.tenantName}</TableCell>
                    <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(invoice.totalCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(invoice.paidCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(outstandingCents(invoice.totalCents, invoice.paidCents))}
                    </TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={invoice.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}
