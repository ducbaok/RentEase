import type { Metadata } from 'next'
import Link from 'next/link'
import type { Route } from 'next'
import { requireOperator } from '@/lib/auth'
import { PageHeader } from '@/components/shared/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
import { formatPeriod } from '@/lib/domain/period'
import { getDashboardSummary } from '@/lib/data/dashboard'

export const metadata: Metadata = { title: 'Dashboard' }

/**
 * The overview screen (AC-D1): what came in and what is still owed this month,
 * how full the buildings are, which leases are about to end, and which units
 * are past due. Every number comes from getDashboardSummary, which reads under
 * the operator's own RLS — so this page shows one organization and no filter
 * here could widen that.
 */
export default async function DashboardPage() {
  const identity = await requireOperator()
  const { money, occupancy, expiringLeases, overdueUnits } = await getDashboardSummary()

  const within30 = expiringLeases.filter((lease) => lease.within === 30)
  const within60 = expiringLeases.filter((lease) => lease.within === 60)

  return (
    <>
      <PageHeader
        title={`Welcome, ${identity.fullName ?? identity.email}`}
        description={`${identity.orgName} — overview for ${formatPeriod(money.period)}.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Collected this month"
          value={formatCents(money.collectedCents)}
          hint={`of ${formatCents(money.billedCents)} billed`}
          testId="dash-collected"
        />
        <StatCard
          title="Still outstanding"
          value={formatCents(money.outstandingCents)}
          hint={`${formatPeriod(money.period)}`}
          testId="dash-outstanding"
        />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Occupancy</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums" data-testid="dash-occupancy-percent">
              {occupancy.ratePercent}%
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              <span data-testid="dash-occupancy-occupied">{occupancy.occupied}</span> of{' '}
              <span data-testid="dash-occupancy-total">{occupancy.total}</span> units occupied
            </p>
          </CardContent>
        </Card>
        <StatCard
          title="Units past due"
          value={String(overdueUnits.length)}
          hint={overdueUnits.length === 1 ? 'invoice to chase' : 'invoices to chase'}
          testId="dash-overdue-count"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Past due</CardTitle>
          </CardHeader>
          <CardContent>
            {overdueUnits.length === 0 ? (
              <EmptyState
                title="Nothing past due"
                description="Every issued invoice is either paid or still within its due date."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Unit</TableHead>
                    <TableHead>Resident</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody data-testid="dash-overdue-list">
                  {overdueUnits.map((unit) => (
                    <TableRow key={unit.invoiceId}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/invoices/${unit.invoiceId}` as Route}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {unit.unitCode}
                        </Link>
                      </TableCell>
                      <TableCell>{unit.tenantName}</TableCell>
                      <TableCell className="tabular-nums">{unit.dueDate}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(unit.outstandingCents)}
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
            <CardTitle className="text-base">Leases ending soon</CardTitle>
          </CardHeader>
          <CardContent>
            {expiringLeases.length === 0 ? (
              <EmptyState
                title="No leases ending soon"
                description="Nothing expires in the next 60 days."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Unit</TableHead>
                    <TableHead>Resident</TableHead>
                    <TableHead>Ends</TableHead>
                    <TableHead className="text-right">In</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody data-testid="dash-expiring-list">
                  {[...within30, ...within60].map((lease) => (
                    <TableRow key={lease.id}>
                      <TableCell className="font-medium">{lease.unitCode}</TableCell>
                      <TableCell>{lease.tenantName}</TableCell>
                      <TableCell className="tabular-nums">{lease.endDate}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={lease.within === 30 ? 'warning' : 'secondary'}>
                          {lease.daysLeft} days
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function StatCard({
  title,
  value,
  hint,
  testId,
}: {
  title: string
  value: string
  hint: string
  testId: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums" data-testid={testId}>
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}
