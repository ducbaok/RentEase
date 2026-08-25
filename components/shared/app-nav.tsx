'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export interface NavItem {
  /** Typed so a renamed page breaks the build rather than the navigation. */
  href: Route
  label: string
}

export interface NavSection {
  title: string
  items: NavItem[]
}

/**
 * Sidebar navigation.
 *
 * Grouped by the shape of the month rather than by database table: you set up
 * the buildings once, you do the billing every month, and residents send you
 * things in between. A landlord looking for "issue invoices" should not have to
 * know which entity it belongs to.
 */
export function AppNav({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname()

  return (
    <nav className="flex flex-col gap-6">
      {sections.map((section) => (
        <div key={section.title} className="space-y-1">
          <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {section.title}
          </p>
          {section.items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-1.5 text-sm transition-colors',
                  active
                    ? 'bg-accent font-medium text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
