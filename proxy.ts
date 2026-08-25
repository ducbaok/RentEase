import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy-session'

/**
 * Runs before every matched request.
 *
 * Next.js 16 renamed this file convention from `middleware.ts` to `proxy.ts`;
 * the behaviour is unchanged. Its only job here is to keep the Supabase session
 * cookie fresh and bounce signed-out visitors to the sign-in page.
 *
 * It is NOT the security boundary — the docs are explicit that this should not
 * be a full authorization solution, and RentEase does not treat it as one.
 * What data anyone can read is decided by row-level security in the database,
 * so a mistake here costs a wrong redirect, never a leak.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Auth cookies must be
     * refreshed on real navigations, not on every icon request.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
