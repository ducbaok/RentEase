import type { Metadata } from 'next'
import Link from 'next/link'
import type { Route } from 'next'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { formatPeriod } from '@/lib/domain/period'
import { listOpenInvoices } from '@/lib/data/invoices'
import { listPayments, PAYMENT_METHOD_LABELS } from '@/lib/data/payments'
import { InvoiceStatusBadge } from '../invoices/_components/invoice-status-badge'
import { formatDateTime } from '../invoices/_components/format'
import { DeletePaymentForm } from './delete-payment-form'
import { PaymentForm, type PayableInvoice } from './payment-form'

export const metadata: Metadata = { title: 'Payments' }

export default async function PaymentsPage() {
  const [payments, open] = await Promise.all([listPayments(), listOpenInvoices()])
  const today = new Date().toISOString().slice(0, 10)

  const payable: PayableInvoice[] = open.map((invoice) => ({
    id: invoice.id,
    label: `${invoice.unitCode} · ${invoice.tenantName} · ${formatPeriod(invoice.period)} · ${formatCents(
      outstandingCents(invoice.totalCents, invoice.paidCents),
    )} outstanding`,
    outstandingCents: outstandingCents(invoice.totalCents, invoice.paidCents),
  }))

  const received = payments.reduce((sum, payment) => sum + payment.amountCents, 0)

  return (
    <>
      <PageHeader
        title="Payments"
        description={`${formatCents(received)} recorded across ${payments.length} payment${payments.length === 1 ? '' : 's'}.`}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(320px,420px)]">
        <Card>
          <CardHeader>
            <CardTitle>Received</CardTitle>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <EmptyState
                title="No payments recorded"
                description="Once an invoice is issued, record what arrives against it here — in full or in part."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Received</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Resident</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>How</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(payment.paidAt)}
                      </TableCell>
                      <TableCell className="font-medium">{payment.unitCode}</TableCell>
                      <TableCell>{payment.tenantName}</TableCell>
                      <TableCell>{formatPeriod(payment.period)}</TableCell>
                      <TableCell>{PAYMENT_METHOD_LABELS[payment.method]}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(payment.amountCents)}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/invoices/${payment.invoiceId}` as Route}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          <InvoiceStatusBadge status={payment.invoiceStatus} />
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">
                        <DeletePaymentForm paymentId={payment.id} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Record a payment</CardTitle>
          </CardHeader>
          <CardContent>
            <PaymentForm invoices={payable} today={today} />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
