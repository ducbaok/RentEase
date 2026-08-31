import type { Metadata } from 'next'
import Link from 'next/link'
import type { Route } from 'next'
import { PageHeader } from '@/components/shared/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { isAiConfigured } from '@/lib/ai/provider'
import { currentPeriod, formatPeriod, isPeriod, type Period } from '@/lib/domain/period'
import { getMeterSheet } from '@/lib/data/meters'
import { PeriodNav } from './period-nav'
import { ReadingGrid, type ReadingGridRow } from './reading-grid'

export const metadata: Metadata = { title: 'Meter readings' }

export default async function MetersPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const params = await searchParams
  const period: Period = isPeriod(params.period) ? params.period : currentPeriod()
  const sheet = await getMeterSheet(period)

  const rows: ReadingGridRow[] = sheet.rows.map((row) => ({
    unitId: row.unitId,
    unitCode: row.unitCode,
    propertyName: row.propertyName,
    electricPrev: row.electricPrev,
    waterPrev: row.waterPrev,
    electricCurr: row.reading ? Number(row.reading.electric_curr) : null,
    waterCurr: row.reading ? Number(row.reading.water_curr) : null,
    history: row.history,
    leased: row.leased,
    savedFlags: row.flags,
    overrideReason: row.reading?.override_reason ?? null,
  }))

  return (
    <>
      <PageHeader
        title="Meter readings"
        description={`Electricity and water for ${formatPeriod(period)}.`}
        actions={
          <div className="flex items-center gap-2">
            <PeriodNav period={period} basePath="/meters" />
            <Button asChild variant="outline">
              <Link href={`/invoices/issue?period=${period}` as Route}>Issue invoices</Link>
            </Button>
          </div>
        }
      />

      {sheet.rows.length === 0 ? (
        <EmptyState
          title="No units yet"
          description="Add a property and its units first — meters belong to units, so there is nothing to read until then."
          action={
            <Button asChild>
              <Link href="/properties">Go to properties</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {sheet.missing > 0 ? (
            <Alert variant="warning">
              <AlertDescription>
                {sheet.missing} leased unit{sheet.missing === 1 ? ' has' : 's have'} no reading for{' '}
                {formatPeriod(period)} yet. Units without a reading are billed rent only.
              </AlertDescription>
            </Alert>
          ) : null}

          {/*
            * Whether a camera button is drawn at all is decided here, on the
            * server, because it is a fact about the deployment rather than
            * about this landlord: with no provider configured every button
            * could only ever answer "photo reading is switched off". Typing
            * the numbers in is the normal path and is untouched either way
            * (AC9.4).
            */}
          <ReadingGrid period={period} rows={rows} photoReading={isAiConfigured()} />
        </div>
      )}
    </>
  )
}
