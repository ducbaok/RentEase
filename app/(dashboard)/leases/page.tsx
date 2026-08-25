import type { Metadata } from 'next'
import { PlannedPage } from '@/components/shared/planned-page'

export const metadata: Metadata = { title: 'Leases' }

export default function Page() {
  return (
    <PlannedPage
      title="Leases"
      description="Who rents which unit, and until when."
      buildsIn="Batch 1 · stream 1A"
      willDo="Attach a resident to a unit with dates, rent, deposit and a billing day. The database refuses two active leases on the same unit."
    />
  )
}
