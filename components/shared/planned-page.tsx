import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * Placeholder for a screen a later batch builds.
 *
 * It names the stream that owns the screen, so the shell is honest about what
 * is not built yet instead of showing a dead link or an empty table that looks
 * like lost data. Each of these files is deleted by the stream that replaces
 * it — no other stream touches them, so they cannot cause a merge conflict.
 */
export function PlannedPage({
  title,
  description,
  buildsIn,
  willDo,
}: {
  title: string
  description: string
  buildsIn: string
  willDo: string
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState title={`Arrives in ${buildsIn}`} description={willDo} />
    </>
  )
}
