import Link from 'next/link'
import { getIdentity, homePathFor } from '@/lib/auth'
import { Button } from '@/components/ui/button'

/**
 * The 404 page.
 *
 * `notFound()` is thrown deliberately in several places — an invoice id that no
 * longer exists, or one that belongs to another organization and is therefore
 * invisible under RLS. Both land here, and they must look identical: a page
 * that said "this invoice belongs to someone else" would confirm the id exists,
 * turning a 404 into an enumeration oracle.
 *
 * The way back is resolved from the caller's own identity, so an operator, a
 * resident and a product admin are each offered their own side of the app
 * rather than a link that bounces them through a redirect.
 */
export default async function NotFound() {
  const identity = await getIdentity()
  const home = homePathFor(identity)
  const label =
    identity.kind === 'tenant'
      ? 'Back to your bills'
      : identity.kind === 'anonymous'
        ? 'Go to sign in'
        : 'Back to the dashboard'

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16 text-center">
      <p className="text-sm font-medium text-primary">404</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">
        There is nothing at this address
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        The page may have been removed, or the link may be for something you do not have access
        to. Either way, nothing here belongs to you.
      </p>
      <div className="mt-8 flex justify-center">
        <Button asChild>
          <Link href={home}>{label}</Link>
        </Button>
      </div>
    </main>
  )
}
