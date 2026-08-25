import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/lib/auth'
import { getPortalInvoiceDetail } from '@/lib/data/portal'
import { formatCents } from '@/lib/domain/money'
import { outstandingCents } from '@/lib/domain/invoice-status'
import { formatPeriod, type Period } from '@/lib/domain/period'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PAYMENT_METHOD_LABELS } from '@/lib/data/payments'
import { BreakdownTable } from '@/app/(dashboard)/invoices/_components/breakdown-table'
import { InvoiceStatusBadge } from '@/app/(dashboard)/invoices/_components/invoice-status-badge'
import { formatDate, formatDateTime } from '@/app/(dashboard)/invoices/_components/format'

export const metadata: Metadata = { title: 'Your bill' }

/**
 * A resident's view of one bill.
 *
 * It renders the invoice's own breakdown snapshot through the SAME component the
 * landlord's screen uses, so "the resident sees exactly the formula the landlord
 * sees" (AC7.2) is guaranteed by construction, not by two views kept in step by
 * hand. RLS decides whether the row is theirs at all — a guessed id from another
 * unit returns nothing, which becomes a 404 (AC7.1).
 */
export default async function PortalInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireTenant()
  const { id } = await params
  const detail = await getPortalInvoiceDetail(id)
  if (!detail) notFound()

  const { invoice, breakdown, payments } = detail
  const outstanding = outstandingCents(invoice.total_cents, invoice.paid_cents)

  return (
    <>
      <PageHeader
        title={`Unit ${detail.unitCode} · ${formatPeriod(invoice.period as Period)}`}
        description={`${detail.propertyName} · due ${formatDate(invoice.due_date)}`}
        actions={
          <div className="flex items-center gap-3">
            <InvoiceStatusBadge status={invoice.status} />
            <Button asChild variant="outline">
              <Link href="/portal">Back</Link>
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>What this bill is made of</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <BreakdownTable breakdown={breakdown} totalCents={invoice.total_cents} />
            <p className="text-sm text-muted-foreground">
              {`These are the figures that applied when the bill was issued on ${formatDateTime(
                invoice.issued_at as string,
              )} — a later change to the rates does not restate it.`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing received yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Received</TableHead>
                    <TableHead>How</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>{formatDateTime(payment.paid_at)}</TableCell>
                      <TableCell>{PAYMENT_METHOD_LABELS[payment.method]}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(payment.amount_cents)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-semibold">Outstanding</TableCell>
                    <TableCell />
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatCents(outstanding)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
