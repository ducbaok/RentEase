import type { Metadata } from 'next'
import Link from 'next/link'
import { MagicLinkForm } from './magic-link-form'
import { Alert, AlertDescription } from '@/components/ui/alert'

export const metadata: Metadata = { title: 'Resident sign-in' }

const ERRORS: Record<string, string> = {
  'no-invite':
    'That email is not on any invitation yet. Ask your landlord to invite you, then try again.',
  'link-expired': 'That sign-in link has expired or was already used. Request a new one below.',
}

/**
 * Where a resident signs in. Reached from the invitation email their landlord
 * sends; needs nothing but the email address on that invitation.
 */
export default async function MagicLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const message = error ? ERRORS[error] : undefined

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Resident sign-in</h1>
        <p className="text-sm text-muted-foreground">
          Enter the email your landlord invited. We&apos;ll send you a one-time link — no password to
          remember.
        </p>
      </div>
      {message ? (
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      <MagicLinkForm />
      <p className="text-center text-sm text-muted-foreground">
        Are you a landlord?{' '}
        <Link href="/sign-in" className="font-medium text-primary hover:underline">
          Sign in here
        </Link>
      </p>
    </div>
  )
}
