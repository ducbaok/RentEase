import { SkeletonCards, SkeletonPageHeader, SkeletonRegion, SkeletonTable } from '@/components/shared/skeleton'

/**
 * Placeholder while the overview resolves.
 *
 * ⚠️ READ BEFORE ADDING ANOTHER ONE OF THESE.
 *
 * A loading.tsx makes Next STREAM the whole segment beneath it: the response is
 * flushed with HTTP 200 and the shell before the page component runs. A page
 * that later calls notFound() can then only swap the rendered content — the
 * status is already sent, so the browser gets 200.
 *
 * That is not cosmetic here. Reaching another organization's record by guessing
 * its id must answer 404 (portfolio.spec.ts and portal.spec.ts both assert it),
 * and RLS makes those rows invisible, which is exactly what makes the page call
 * notFound(). A loading.tsx placed over a subtree containing a [id] route turns
 * every one of those 404s into a 200.
 *
 * So these live ONLY on segments with no notFound() anywhere beneath them. The
 * list screens that sit above a detail route deliberately have none.
 */
export default function Loading() {
  return (
    <SkeletonRegion label="Loading the overview">
      <SkeletonPageHeader />
      <SkeletonCards count={4} />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SkeletonTable rows={4} columns={4} />
        <SkeletonTable rows={4} columns={4} />
      </div>
    </SkeletonRegion>
  )
}
