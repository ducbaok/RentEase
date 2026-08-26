import type { Metadata } from 'next'
import Link from 'next/link'
import type { Route } from 'next'
import { notFound } from 'next/navigation'
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
import { formatCents } from '@/lib/domain/money'
import { outstandingCents } from '@/lib/domain/invoice-status'
import { formatPeriod, type Period } from '@/lib/domain/period'
import { isMeteredLine } from '@/lib/domain/breakdown'
import { getInvoiceDetail } from '@/lib/data/invoices'
import { PAYMENT_METHOD_LABELS } from '@/lib/data/payments'
import { PaymentForm } from '../../payments/payment-form'
import { BreakdownTable } from '../_components/breakdown-table'
import { InvoiceStatusBadge } from '../_components/invoice-status-badge'
import { AuditChange } from '../_components/audit-change'
import { formatDate, formatDateTime } from '../_components/format'
import { AdjustForm } from './adjust-form'

export const metadata: Metadata = { title: 'Invoice' }

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getInvoiceDetail(id)
  if (!detail) notFound()

  const { invoice, breakdown, payments, audit } = detail
  const outstanding = outstandingCents(invoice.total_cents, invoice.paid_cents)
  const today = new Date().toISOString().slice(0, 10)
  const otherLine = breakdown.find((line) => line.kind === 'other')

  return (
    <>
      <PageHeader
        title={`Unit ${detail.unitCode} · ${formatPeriod(invoice.period as Period)}`}
        description={`${detail.tenantName} · ${detail.propertyName} · due ${formatDate(invoice.due_date)}`}
        actions={
          <div className="flex items-center gap-3">
            <InvoiceStatusBadge status={invoice.status} />
            <Button asChild variant="outline">
              <Link href={`/invoices?period=${invoice.period}` as Route}>Back to invoices</Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(320px,420px)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>What this bill is made of</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <BreakdownTable breakdown={breakdown} totalCents={invoice.total_cents} />
              {breakdown.some(isMeteredLine) ? null : (
                <p className="text-sm text-muted-foreground">
                  No meter reading was entered for this unit and month, so only rent and fees were
                  billed.
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                {invoice.issued_at
                  ? `Issued ${formatDateTime(invoice.issued_at)}. These figures are the ones that applied then — changing your rates later does not restate this invoice.`
                  : 'Not issued yet.'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing received yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Received</TableHead>
                      <TableHead>How</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell>{formatDateTime(payment.paid_at)}</TableCell>
                        <TableCell>{PAYMENT_METHOD_LABELS[payment.method]}</TableCell>
                        <TableCell className="text-muted-foreground">{payment.note ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCents(payment.amount_cents)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="font-semibold">Outstanding</TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatCents(outstanding)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
              <p className="text-xs text-muted-foreground">
                Remove a payment from the <Link href="/payments" className="underline">payments</Link>{' '}
                page — the balance is recalculated from scratch, so nothing is left behind.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              {audit.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing has been changed since this invoice was issued.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Change</TableHead>
                      <TableHead>Why</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="whitespace-nowrap">
                          {formatDateTime(entry.created_at)}
                        </TableCell>
                        <TableCell className="text-sm">
                          <AuditChange oldValue={entry.old_value} newValue={entry.new_value} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">{entry.reason ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Record a payment</CardTitle>
            </CardHeader>
            <CardContent>
              <PaymentForm
                today={today}
                fixedInvoiceId={invoice.id}
                invoices={
                  outstanding > 0
                    ? [{ id: invoice.id, label: detail.unitCode, outstandingCents: outstanding }]
                    : []
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Correction</CardTitle>
            </CardHeader>
            <CardContent>
              <AdjustForm
                invoiceId={invoice.id}
                rentCents={invoice.rent_cents}
                otherCents={invoice.other_cents}
                otherLabel={otherLine?.label ?? ''}
                dueDate={invoice.due_date}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
