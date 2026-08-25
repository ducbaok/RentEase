import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getIdentity, homePathFor } from '@/lib/auth'
import { Button } from '@/components/ui/button'

export default async function HomePage() {
  const identity = await getIdentity()

  // Anyone already signed in goes straight to their own side of the app.
  if (identity.kind !== 'anonymous') redirect(homePathFor(identity))

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-medium text-primary">RentEase</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
        Rent, utilities and leases — without the spreadsheet.
      </h1>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        Enter your meter readings, issue every invoice for the month in one click, and let the
        overdue reminders send themselves. Residents get a link, not an app to install.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href="/sign-up">Create an account</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    </main>
  )
}
