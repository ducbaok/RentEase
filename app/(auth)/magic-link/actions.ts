'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { APP_URL } from '@/lib/env'

/**
 * Resident sign-in by magic link (F7).
 *
 * A resident never has a password. They enter their email, Supabase mails a
 * one-time link, and clicking it lands on /magic-link/callback, which links the
 * account to the tenant record their landlord invited.
 *
 * shouldCreateUser is true: an invited resident may not have an auth account
 * yet, and the link is what creates it. The claim step then refuses to link an
 * email nobody invited, so this cannot be used to self-provision access to data.
 */

export interface MagicLinkState {
  error?: string
  message?: string
}

const schema = z.object({ email: z.email('Enter a valid email address.') })

export async function requestMagicLink(
  _prev: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const parsed = schema.safeParse({ email: formData.get('email') })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Enter a valid email address.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${APP_URL}/magic-link/callback`,
      shouldCreateUser: true,
    },
  })

  if (error) {
    // Deliberately generic — the response must not reveal whether an email is
    // known, and a rate-limit message would confirm the address exists.
    return { error: 'We could not send the link just now. Please try again in a moment.' }
  }

  // Always the same reassuring message, whether or not the email matched an
  // invitation. What is behind the door is decided at the callback, not here.
  return {
    message: 'Check your email for a sign-in link. It works once and expires shortly.',
  }
}
