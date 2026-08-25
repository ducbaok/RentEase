import type { Route } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Who is asking.
 *
 * RentEase has three mutually exclusive identities, and the separation is
 * structural rather than a role column: an operator is a row in public.users,
 * a resident is a row in public.tenants linked through portal_user_id, and a
 * product admin is a row in public.super_admins. Nobody can be two of them,
 * which is why a resident fails every operator policy in the database without
 * any code needing to check for it.
 *
 * `unaffiliated` is the brief window after signing up but before creating an
 * organization — a real state that must be handled, not an error.
 */

export interface OperatorIdentity {
  kind: 'operator'
  userId: string
  email: string
  fullName: string | null
  orgId: string
  orgName: string
  role: 'owner' | 'manager'
}

export interface TenantIdentity {
  kind: 'tenant'
  userId: string
  email: string
  tenantId: string
  orgId: string
  fullName: string
}

export interface SuperIdentity {
  kind: 'super'
  userId: string
  email: string
}

export type Identity =
  | OperatorIdentity
  | TenantIdentity
  | SuperIdentity
  | { kind: 'unaffiliated'; userId: string; email: string }
  | { kind: 'anonymous' }

export async function getIdentity(): Promise<Identity> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { kind: 'anonymous' }
  const email = user.email ?? ''

  const { data: operator } = await supabase
    .from('users')
    .select('org_id, role, full_name, organizations(name)')
    .eq('id', user.id)
    .maybeSingle()

  if (operator) {
    return {
      kind: 'operator',
      userId: user.id,
      email,
      fullName: operator.full_name,
      orgId: operator.org_id,
      orgName: operator.organizations?.name ?? 'Your organization',
      role: operator.role,
    }
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, org_id, full_name')
    .eq('portal_user_id', user.id)
    .maybeSingle()

  if (tenant) {
    return {
      kind: 'tenant',
      userId: user.id,
      email,
      tenantId: tenant.id,
      orgId: tenant.org_id,
      fullName: tenant.full_name,
    }
  }

  const { data: superAdmin } = await supabase
    .from('super_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (superAdmin) return { kind: 'super', userId: user.id, email }

  return { kind: 'unaffiliated', userId: user.id, email }
}

/**
 * Where an identity belongs. Used to bounce people to their own side of the app.
 *
 * Typed as `Route` so typedRoutes checks these paths at compile time — a
 * renamed page breaks the build instead of stranding someone on a 404 after
 * they sign in.
 */
export function homePathFor(identity: Identity): Route {
  switch (identity.kind) {
    case 'operator':
      return '/dashboard'
    case 'tenant':
      return '/portal'
    case 'super':
      return '/admin'
    case 'unaffiliated':
      return '/sign-up/organization'
    default:
      return '/sign-in'
  }
}

/**
 * Guards for the three route groups.
 *
 * These decide which PAGE someone sees. They are not the security boundary —
 * that is RLS — so a mistake here shows the wrong navigation, not another
 * landlord's data.
 */
export async function requireOperator(): Promise<OperatorIdentity> {
  const identity = await getIdentity()
  if (identity.kind !== 'operator') redirect(homePathFor(identity))
  return identity
}

export async function requireTenant(): Promise<TenantIdentity> {
  const identity = await getIdentity()
  if (identity.kind !== 'tenant') redirect(homePathFor(identity))
  return identity
}

export async function requireSuperAdmin(): Promise<SuperIdentity> {
  const identity = await getIdentity()
  if (identity.kind !== 'super') redirect(homePathFor(identity))
  return identity
}
