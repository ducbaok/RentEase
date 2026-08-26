import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env'

/**
 * Paths reachable without a session. '/magic-link' is here because a resident
 * accepting an invitation has no session yet — the page and its callback are how
 * they get one (F7). This only decides which page renders; RLS still decides
 * what any resulting session can read.
 */
const PUBLIC_PREFIXES = [
  '/sign-in',
  '/sign-up',
  '/magic-link',
  '/auth',
  '/api/webhooks',
  '/api/cron',
]

function isPublic(pathname: string): boolean {
  return pathname === '/' || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
}

/**
 * Refreshes the Supabase session cookie on every request and bounces
 * unauthenticated visitors to sign-in.
 *
 * This is a convenience layer, not the security boundary: it decides which
 * PAGE you land on, never which ROWS you can read. That belongs to RLS, so a
 * mistake here leaks a layout, not data.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // getUser() revalidates the token with Supabase. Do not swap it for
  // getSession(), which trusts whatever the cookie claims.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && !isPublic(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone()

    // Residents have no password, so /sign-in is a door they cannot open: its
    // form wants a password and its only link creates a LANDLORD account. Their
    // door is the magic link. This matters because every reminder email points
    // at /portal, and a resident who has not signed in yet arrives here first.
    if (request.nextUrl.pathname.startsWith('/portal')) {
      url.pathname = '/magic-link'
      url.search = ''
      return NextResponse.redirect(url)
    }

    url.pathname = '/sign-in'
    url.searchParams.set('next', request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  return response
}
