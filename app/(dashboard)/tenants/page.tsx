import type { Metadata } from 'next'
import { PlannedPage } from '@/components/shared/planned-page'

export const metadata: Metadata = { title: 'Residents' }

export default function Page() {
  return (
    <PlannedPage
      title="Residents"
      description="The people renting from you."
      buildsIn="Batch 1 · stream 1A"
      willDo="Keep names and contact details, and invite residents to their own portal where they can see invoices and report problems."
    />
  )
}
