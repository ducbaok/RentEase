import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { EmailOtpType } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env'

/**
 * Magic-link landing (F7).
 *
 * Supabase sends the resident here after they click the emailed link. Two link
 * shapes are accepted:
 *   - `?code=…`               the PKCE flow a real click produces
 *   - `?token_hash=…&type=…`  verified directly, which is also how the e2e test
 *                             signs in without depending on the redirect
 *                             allow-list or the dev server's port
 *
 * The Supabase client is bound to the OUTGOING redirect response, not to
 * next/headers: a fresh session cookie set on a route handler's cookie store is
 * not reliably carried onto a NextResponse.redirect, which would leave the
 * resident bounced straight back to sign-in. So the new cookies are written onto
 * the exact response we return, and the claim runs on this same authenticated
 * client (migration 0826) — a later next/headers read would not yet see the
 * session that only exists on this response.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = (searchParams.get('type') as EmailOtpType | null) ?? 'email'

  const pendingCookies: Array<{ name: string; value: string; options: CookieOptions }> = []
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        pendingCookies.push(...cookiesToSet)
      },
    },
  })

  // Redirect on the SAME host the browser actually used, taken from the Host
  // header. The session cookie is set host-only, so redirecting to a different
  // host spelling (127.0.0.1 vs localhost — request.nextUrl normalises to the
  // server's bound hostname, not the browser's) would drop the cookie and
  // bounce the resident straight back to sign-in.
  const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '')
  const host = request.headers.get('host') ?? request.nextUrl.host
  const base = `${proto}://${host}`
  const redirectTo = (path: string, error?: string): NextResponse => {
    const url = new URL(path, base)
    if (error) url.searchParams.set('error', error)
    const response = NextResponse.redirect(url)
    for (const { name, value, options } of pendingCookies) {
      response.cookies.set(name, value, options)
    }
    return response
  }

  let authenticated = false
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    authenticated = !error
  } else if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    authenticated = !error
  }

  if (!authenticated) {
    return redirectTo('/magic-link', 'link-expired')
  }

  const { error: claimError } = await supabase.rpc('claim_tenant_portal')
  if (claimError) {
    // 42501 = an operator account used a resident link; send them to their side.
    if (claimError.code === '42501') return redirectTo('/dashboard')
    // P0002 (no invitation) or anything unexpected: don't strand an
    // unaffiliated session on a portal it cannot read — sign out and explain.
    await supabase.auth.signOut()
    return redirectTo('/magic-link', 'no-invite')
  }

  return redirectTo('/portal')
}
