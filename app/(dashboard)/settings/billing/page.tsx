import type { Metadata } from 'next'
import { PlannedPage } from '@/components/shared/planned-page'

export const metadata: Metadata = { title: 'Plan & billing' }

export default function Page() {
  return (
    <PlannedPage
      title="Plan & billing"
      description="Your RentEase subscription."
      buildsIn="Batch 3 · stream 3A"
      willDo="Choose a plan priced by how many units you manage. Going over your limit prompts an upgrade and never locks the data you already have."
    />
  )
}
