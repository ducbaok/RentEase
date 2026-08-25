import Link from 'next/link'
import { requireTenant } from '@/lib/auth'
import { SignOutButton } from '@/components/shared/sign-out-button'

/**
 * The resident side of the app.
 *
 * Deliberately plain: a resident opens a link a few times a year to check a
 * bill or report a leak. There is no navigation to learn, and nothing here
 * needs installing.
 *
 * requireTenant() decides which page loads. What a resident can actually READ
 * is decided by the second RLS layer in the database — so unit 201 cannot
 * reach unit 202 even by typing the address directly.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const identity = await requireTenant()

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Link href="/portal" className="text-sm font-semibold tracking-tight text-primary">
              RentEase
            </Link>
            <nav className="flex items-center gap-3 text-sm text-muted-foreground">
              <Link href="/portal" className="hover:text-foreground">
                Bills
              </Link>
              <Link href="/portal/maintenance" className="hover:text-foreground">
                Repairs
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {identity.fullName}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
