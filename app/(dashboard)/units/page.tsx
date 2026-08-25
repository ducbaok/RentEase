import type { Metadata } from 'next'
import { PlannedPage } from '@/components/shared/planned-page'

export const metadata: Metadata = { title: 'Units' }

export default function Page() {
  return (
    <PlannedPage
      title="Units"
      description="Every unit across your properties."
      buildsIn="Batch 1 · stream 1A"
      willDo="One list of every unit with its rent, size and whether it is occupied — so you can see the whole portfolio without opening each building."
    />
  )
}
