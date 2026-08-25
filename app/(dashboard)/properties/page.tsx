import type { Metadata } from 'next'
import { PlannedPage } from '@/components/shared/planned-page'

export const metadata: Metadata = { title: 'Properties' }

export default function Page() {
  return (
    <PlannedPage
      title="Properties"
      description="Your buildings and the units inside them."
      buildsIn="Batch 1 · stream 1A"
      willDo="Add a building, then add its units with a code, size and default rent. Occupancy on the dashboard follows from what you enter here."
    />
  )
}
