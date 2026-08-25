import type { Metadata } from 'next'
import { PlannedPage } from '@/components/shared/planned-page'

export const metadata: Metadata = { title: 'Payments' }

export default function Page() {
  return (
    <PlannedPage
      title="Payments"
      description="Who has paid, and who has not."
      buildsIn="Batch 1 · stream 1B"
      willDo="Record payments in full or in part; the balance and the invoice status follow automatically."
    />
  )
}
