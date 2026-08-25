import type { Metadata } from 'next'
import { PlannedPage } from '@/components/shared/planned-page'

export const metadata: Metadata = { title: 'Maintenance' }

export default function Page() {
  return (
    <PlannedPage
      title="Maintenance"
      description="Problems residents have reported."
      buildsIn="Batch 2 · stream 2A"
      willDo="Every request with its photos, moving through submitted, in progress and done. Each change notifies the resident."
    />
  )
}
