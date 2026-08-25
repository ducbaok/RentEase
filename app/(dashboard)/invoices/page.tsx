import type { Metadata } from 'next'
import { PlannedPage } from '@/components/shared/planned-page'

export const metadata: Metadata = { title: 'Invoices' }

export default function Page() {
  return (
    <PlannedPage
      title="Invoices"
      description="One click bills the whole building."
      buildsIn="Batch 1 · stream 1B"
      willDo="Issue every invoice for a month at once — rent, electricity, water and fees, each showing the arithmetic behind it. Issuing twice never creates a second invoice."
    />
  )
}
