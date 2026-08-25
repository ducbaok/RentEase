/**
 * Environment access.
 *
 * Missing configuration fails loudly at the first use rather than surfacing
 * later as an unexplained 401 from Supabase. The NEXT_PUBLIC_ values are read
 * through literal `process.env.X` expressions so Next can inline them into the
 * client bundle; server-only values go through `serverEnv`, which throws if it
 * is ever reached from the browser.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in (\`pnpm supabase start\` prints the local values).`,
    )
  }
  return value
}

export const SUPABASE_URL = required(
  'NEXT_PUBLIC_SUPABASE_URL',
  process.env.NEXT_PUBLIC_SUPABASE_URL,
)

export const SUPABASE_ANON_KEY = required(
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/** Reads a server-side variable. Throws if called in the browser. */
export function serverEnv(name: string): string {
  if (typeof window !== 'undefined') {
    throw new Error(`${name} is server-only and must never be read in the browser.`)
  }
  return required(name, process.env[name])
}

/** Like serverEnv but returns undefined instead of throwing when unset. */
export function optionalServerEnv(name: string): string | undefined {
  if (typeof window !== 'undefined') return undefined
  const value = process.env[name]
  return value && value.length > 0 ? value : undefined
}
