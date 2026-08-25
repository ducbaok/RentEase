import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@/components/shared/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { currentPeriod } from '@/lib/domain/period'
import { ELECTRIC_UNIT, WATER_UNIT } from '@/lib/domain/billing'
import { listTariffs, selectEffectiveTariff } from '@/lib/data/tariffs'
import { formatDate, formatRate } from '../invoices/_components/format'
import { createTariffAction, deleteTariffAction } from './actions'
import { TariffForm } from './tariff-form'

export const metadata: Metadata = { title: 'Rates' }

export default async function TariffsPage() {
  const tariffs = await listTariffs()
  const period = currentPeriod()
  const effective = selectEffectiveTariff(tariffs, period)
  const today = new Date().toISOString().slice(0, 10)

  return (
    <>
      <PageHeader
        title="Rates"
        description="What you charge for electricity, water and monthly fees."
      />

      <Alert className="mb-6">
        <AlertTitle>You set these rates, and you answer for them</AlertTitle>
        <AlertDescription>
          RentEase does not check your rates against submetering rules, which differ by state.
          Billing residents for utilities is regulated in many places — make sure what you charge
          is allowed where the property is.
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(320px,420px)]">
        <Card>
          <CardHeader>
            <CardTitle>Rate history</CardTitle>
          </CardHeader>
          <CardContent>
            {tariffs.length === 0 ? (
              <EmptyState
                title="No rates yet"
                description="Add a rate card before issuing invoices — without one there is no price to apply to a meter reading."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Starts</TableHead>
                    <TableHead className="text-right">Electricity / {ELECTRIC_UNIT}</TableHead>
                    <TableHead className="text-right">Water / {WATER_UNIT}</TableHead>
                    <TableHead className="text-right">Service fee</TableHead>
                    <TableHead className="text-right">Edit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tariffs.map((tariff) => (
                    <TableRow key={tariff.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {formatDate(tariff.effective_from)}
                          {effective?.id === tariff.id ? (
                            <Badge variant="success">Billing {period}</Badge>
                          ) : null}
                          {tariff.effective_from > today ? (
                            <Badge variant="outline">Scheduled</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatRate(Number(tariff.electric_rate_per_kwh))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatRate(Number(tariff.water_rate_per_unit))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(tariff.service_fee_cents)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/tariffs/${tariff.id}`}>Edit</Link>
                          </Button>
                          <form action={deleteTariffAction}>
                            <input type="hidden" name="id" value={tariff.id} />
                            <Button type="submit" variant="ghost" size="sm">
                              Delete
                            </Button>
                          </form>
                        </div>
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
            <CardTitle>Add a rate card</CardTitle>
          </CardHeader>
          <CardContent>
            <TariffForm
              action={createTariffAction}
              submitLabel="Save rates"
              values={{
                electricRatePerKwh: 0,
                waterRatePerUnit: 0,
                serviceFeeCents: 0,
                effectiveFrom: today,
              }}
            />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
