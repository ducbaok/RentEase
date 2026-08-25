import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_URL, serverEnv } from '@/lib/env'
import type { Database } from '@/lib/types/database'

/**
 * Service-role client. BYPASSES ROW-LEVEL SECURITY ENTIRELY.
 *
 * Only two callers are legitimate, because neither runs with a user session and
 * both must act across organizations:
 *   - app/api/cron/**      the daily reminder job
 *   - app/api/webhooks/**  Stripe delivering subscription state
 *
 * Every other file must use lib/supabase/server.ts. An eslint rule
 * (see eslint.config.mjs) fails the build if this module is imported anywhere
 * else, so the guarantee does not depend on anyone remembering it.
 *
 * Whatever calls this is responsible for its own tenancy filtering — the
 * database will not do it for you here.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    SUPABASE_URL,
    serverEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
