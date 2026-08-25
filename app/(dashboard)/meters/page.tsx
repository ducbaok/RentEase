import type { Metadata } from 'next'
import { PlannedPage } from '@/components/shared/planned-page'

export const metadata: Metadata = { title: 'Meter readings' }

export default function Page() {
  return (
    <PlannedPage
      title="Meter readings"
      description="Electricity and water, entered once a month."
      buildsIn="Batch 1 · stream 1B"
      willDo="Type the new reading and press Enter to jump to the next unit. Last month's number is already there, and a reading that drops or triples asks you to confirm before it is saved."
    />
  )
}
