import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { getTariff } from '@/lib/data/tariffs'
import { updateTariffAction } from '../actions'
import { TariffForm } from '../tariff-form'

export const metadata: Metadata = { title: 'Edit rates' }

export default async function EditTariffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tariff = await getTariff(id)
  if (!tariff) notFound()

  return (
    <>
      <PageHeader
        title="Edit rates"
        description="Correcting a rate card changes what future invoices cost. Invoices already issued keep the rate they were priced with."
        actions={
          <Button asChild variant="outline">
            <Link href="/tariffs">Back to rates</Link>
          </Button>
        }
      />

      <Card className="max-w-2xl">
        <CardContent className="pt-6">
          <TariffForm
            action={updateTariffAction}
            submitLabel="Save changes"
            values={{
              id: tariff.id,
              electricRatePerKwh: Number(tariff.electric_rate_per_kwh),
              waterRatePerUnit: Number(tariff.water_rate_per_unit),
              serviceFeeCents: tariff.service_fee_cents,
              effectiveFrom: tariff.effective_from,
            }}
          />
        </CardContent>
      </Card>
    </>
  )
}
