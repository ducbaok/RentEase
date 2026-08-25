import Link from 'next/link'
import { requireSuperAdmin } from '@/lib/auth'
import { SignOutButton } from '@/components/shared/sign-out-button'

/**
 * The product back office.
 *
 * A third identity that is neither an operator nor a resident: it can list
 * organizations and their subscription state, and nothing inside them. There is
 * no INSERT policy on super_admins, so membership can only be granted by direct
 * SQL — an account can never promote itself here.
 */
export default async function SuperLayout({ children }: { children: React.ReactNode }) {
  const identity = await requireSuperAdmin()

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border bg-muted/40">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/admin" className="text-sm font-semibold tracking-tight">
            RentEase <span className="text-muted-foreground">admin</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{identity.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
