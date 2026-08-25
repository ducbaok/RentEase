import Link from 'next/link'
import { requireOperator } from '@/lib/auth'
import { AppNav, type NavSection } from '@/components/shared/app-nav'
import { SignOutButton } from '@/components/shared/sign-out-button'
import { Badge } from '@/components/ui/badge'

/**
 * The operator side of the app.
 *
 * Every stream in Batch 1 and 2 hangs its pages off this layout, which is why
 * the navigation is declared here in the foundation: adding a page means adding
 * one line to a section, not editing a shared component and colliding with
 * another stream.
 */
const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [{ href: '/dashboard', label: 'Dashboard' }],
  },
  {
    title: 'Portfolio',
    items: [
      { href: '/properties', label: 'Properties' },
      { href: '/units', label: 'Units' },
      { href: '/tenants', label: 'Residents' },
      { href: '/leases', label: 'Leases' },
    ],
  },
  {
    title: 'Monthly billing',
    items: [
      { href: '/meters', label: 'Meter readings' },
      { href: '/invoices', label: 'Invoices' },
      { href: '/payments', label: 'Payments' },
      { href: '/tariffs', label: 'Rates' },
    ],
  },
  {
    title: 'Residents',
    items: [{ href: '/maintenance', label: 'Maintenance' }],
  },
  {
    title: 'Settings',
    items: [{ href: '/settings/billing', label: 'Plan & billing' }],
  },
]

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const identity = await requireOperator()

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm font-semibold tracking-tight text-primary">
              RentEase
            </Link>
            <span className="text-sm text-muted-foreground">{identity.orgName}</span>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="capitalize">
              {identity.role}
            </Badge>
            <span className="hidden text-sm text-muted-foreground sm:inline">{identity.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <aside className="border-b border-border px-4 py-5 lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r lg:px-3">
          <AppNav sections={NAV_SECTIONS} />
        </aside>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
