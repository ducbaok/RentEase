import type { Metadata } from 'next'
import Link from 'next/link'
import type { Route } from 'next'
import { PageHeader } from '@/components/shared/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
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
import { currentPeriod, formatPeriod, isPeriod, type Period } from '@/lib/domain/period'
import { FLAG_LABELS } from '@/lib/domain/anomaly'
import { buildIssuePlan } from '@/lib/data/invoices'
import { formatDate } from '../_components/format'
import { IssueButton } from './issue-button'

export const metadata: Metadata = { title: 'Issue invoices' }

/**
 * AC4.2 — the last look before the bills go out.
 *
 * Nothing on this page writes anything. It exists because "issue invoices for
 * the whole building" is irreversible in the eyes of every resident who
 * receives one, and the two mistakes that actually happen — a unit whose meter
 * nobody read, and a reading that is wrong — are both visible here and nowhere
 * else afterwards.
 */
export default async function IssueInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const params = await searchParams
  const period: Period = isPeriod(params.period) ? params.period : currentPeriod()
  const plan = await buildIssuePlan(period)

  return (
    <>
      <PageHeader
        title={`Issue invoices for ${formatPeriod(period)}`}
        description="Check this over. Nothing has been created yet."
        actions={
          <Button asChild variant="outline">
            <Link href={`/invoices?period=${period}` as Route}>Back to invoices</Link>
          </Button>
        }
      />

      <div className="space-y-6">
        {plan.blocker ? (
          <Alert variant="destructive">
            <AlertTitle>Cannot issue yet</AlertTitle>
            <AlertDescription>
              {plan.blocker}{' '}
              {plan.tariff === null ? <Link href="/tariffs" className="underline">Set your rates</Link> : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {plan.missingReadings.length > 0 ? (
          <Alert variant="warning">
            <AlertTitle>
              {plan.missingReadings.length} unit
              {plan.missingReadings.length === 1 ? ' has' : 's have'} no meter reading
            </AlertTitle>
            <AlertDescription>
              {plan.missingReadings.map((line) => line.unitCode).join(', ')} will be billed rent and
              fees only. <Link href={`/meters?period=${period}` as Route} className="underline">Enter the readings first</Link> if
              that is not what you want.
            </AlertDescription>
          </Alert>
        ) : null}

        {plan.flagged.length > 0 ? (
          <Alert variant="warning">
            <AlertTitle>{plan.flagged.length} reading{plan.flagged.length === 1 ? '' : 's'} looked unusual</AlertTitle>
            <AlertDescription>
              <ul className="ml-4 list-disc">
                {plan.flagged.map((line) => (
                  <li key={line.leaseId}>
                    Unit {line.unitCode}: {line.flags.map((flag) => FLAG_LABELS[flag]).join(', ')}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        {plan.alreadyIssued.length > 0 ? (
          <Alert>
            <AlertTitle>
              {plan.alreadyIssued.length} lease
              {plan.alreadyIssued.length === 1 ? ' is' : 's are'} already invoiced for this month
            </AlertTitle>
            <AlertDescription>
              {plan.alreadyIssued.map((line) => line.unitCode).join(', ')} will be left exactly as
              they are. Issuing again cannot double-bill them.
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>
              {plan.toIssue.length} invoice{plan.toIssue.length === 1 ? '' : 's'} to create ·{' '}
              {formatCents(plan.totalCents)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead>Resident</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Rent</TableHead>
                  <TableHead className="text-right">Electricity</TableHead>
                  <TableHead className="text-right">Water</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.lines.map((line) => (
                  <TableRow key={line.leaseId} data-unit={line.unitCode}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {line.unitCode}
                        {line.existingInvoiceId ? <Badge variant="outline">Already issued</Badge> : null}
                        {line.missingReading && !line.existingInvoiceId ? (
                          <Badge variant="warning">No reading</Badge>
                        ) : null}
                        {line.flags.length > 0 ? <Badge variant="warning">Check reading</Badge> : null}
                      </div>
                      <div className="text-xs text-muted-foreground">{line.propertyName}</div>
                    </TableCell>
                    <TableCell>{line.tenantName}</TableCell>
                    <TableCell>{line.draft ? formatDate(line.draft.dueDate) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.draft ? formatCents(line.draft.rentCents) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.draft ? formatCents(line.draft.electricCents) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.draft ? formatCents(line.draft.waterCents) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.draft ? formatCents(line.draft.serviceCents + line.draft.otherCents) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {line.draft ? formatCents(line.draft.totalCents) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <IssueButton
              period={period}
              count={plan.toIssue.length}
              disabled={plan.blocker !== null}
            />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
