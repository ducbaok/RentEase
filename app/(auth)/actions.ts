'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getIdentity, homePathFor } from '@/lib/auth'

/**
 * Authentication actions.
 *
 * All of them return `{ error }` rather than throwing, so a failed sign-in
 * renders a message next to the form instead of an error page — and they never
 * echo back which half of the credentials was wrong.
 */

export interface AuthActionState {
  error?: string
  message?: string
}

const credentialsSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
})

export async function signIn(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details and try again.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) {
    // Deliberately vague: saying "no such account" would let anyone test
    // whether a given landlord uses RentEase.
    return { error: 'That email and password did not match an account.' }
  }

  const identity = await getIdentity()
  revalidatePath('/', 'layout')
  redirect(homePathFor(identity))
}

export async function signUp(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details and try again.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp(parsed.data)
  if (error) return { error: error.message }

  // With email confirmation disabled locally, signUp also signs the user in;
  // they land on the organization step with no org yet. With confirmation on,
  // there is no session and they are told to check their inbox.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { message: 'Check your inbox to confirm your email address, then sign in.' }
  }

  revalidatePath('/', 'layout')
  redirect('/sign-up/organization')
}

const organizationSchema = z.object({
  orgName: z.string().trim().min(2, 'Give your business a name of at least 2 characters.'),
  fullName: z.string().trim().optional(),
})

/**
 * Creates the organization and its first owner in one database transaction.
 *
 * A user with no organization row has no identity under RLS, so creating the
 * two separately would leave a stranded account if the second insert failed.
 * The RPC is SECURITY DEFINER because at this instant current_org_id() is
 * still NULL and no policy could permit the write.
 */
export async function createOrganization(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = organizationSchema.safeParse({
    orgName: formData.get('orgName'),
    fullName: formData.get('fullName'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check your details and try again.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('create_organization_and_owner', {
    p_org_name: parsed.data.orgName,
    p_full_name: parsed.data.fullName || undefined,
  })

  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/sign-in')
}
