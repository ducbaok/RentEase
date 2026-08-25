import type { Metadata } from 'next'
import { PlannedPage } from '@/components/shared/planned-page'

export const metadata: Metadata = { title: 'Rates' }

export default function Page() {
  return (
    <PlannedPage
      title="Rates"
      description="What you charge for electricity, water and fees."
      buildsIn="Batch 1 · stream 1B"
      willDo="Set your rates with a start date. Changing a rate never rewrites an invoice you already issued."
    />
  )
}
