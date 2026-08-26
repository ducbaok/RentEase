/**
 * The audit trail, read back (AC5.2).
 *
 * Stream 1B writes these rows (writeAuditLog in lib/data/invoices.ts); this
 * module only reads them, which is why it is a separate file: nothing here can
 * accidentally become a second way to write history.
 *
 * VOCABULARY — from 30-data-model.md, and it is closed:
 *   entity ∈ invoice | meter_reading | payment
 *   action ∈ create  | update        | delete
 * The columns are plain `text` rather than enums, so an unknown value is
 * possible in principle and is rendered as itself rather than dropped. A row
 * the reader does not recognise is a signal, not a rendering problem.
 *
 * ISOLATION. Reading goes through the operator's own client, so
 * `audit_logs_operator_select` scopes it to their organization; there is no
 * org_id parameter to pass and no way to ask for someone else's history. There
 * is no UPDATE or DELETE policy on the table at all, so what this shows is the
 * whole record, and nobody — owner included — can have edited it through the
 * API.
 */

import { createClient } from '@/lib/supabase/server'
import { requireOperator } from '@/lib/auth'
import type { Database } from '@/lib/types/database'

type AuditRow = Database['public']['Tables']['audit_logs']['Row']

export const AUDIT_ENTITIES = ['invoice', 'meter_reading', 'payment'] as const
export type AuditEntity = (typeof AUDIT_ENTITIES)[number]

export const AUDIT_ACTIONS = ['create', 'update', 'delete'] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const AUDIT_ENTITY_LABELS: Record<AuditEntity, string> = {
  invoice: 'Invoice',
  meter_reading: 'Meter reading',
  payment: 'Payment',
}

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  create: 'Created',
  update: 'Changed',
  delete: 'Deleted',
}

export function isAuditEntity(value: unknown): value is AuditEntity {
  return typeof value === 'string' && (AUDIT_ENTITIES as readonly string[]).includes(value)
}

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === 'string' && (AUDIT_ACTIONS as readonly string[]).includes(value)
}

export interface AuditEntry {
  id: string
  createdAt: string
  entity: string
  entityId: string
  action: string
  oldValue: AuditRow['old_value']
  newValue: AuditRow['new_value']
  reason: string | null
  /** Who did it. Falls back to the raw id, then to a placeholder, so a removed operator still reads sensibly. */
  actorName: string
  actorEmail: string | null
}

/**
 * How many rows one page of history shows.
 *
 * A cap rather than paging: the screen answers "what changed lately", and an
 * operator who needs the full record has the per-invoice history on the invoice
 * itself. The page says plainly when it is showing a truncated view — a silent
 * cut would read as "nothing else ever happened".
 */
export const AUDIT_PAGE_SIZE = 200

export interface AuditFeed {
  entries: AuditEntry[]
  /** True when older entries exist beyond the cap. */
  truncated: boolean
}

export async function listAuditEntries(
  filters: { entity?: AuditEntity; action?: AuditAction } = {},
): Promise<AuditFeed> {
  await requireOperator()
  const supabase = await createClient()

  let query = supabase.from('audit_logs').select('*')
  if (filters.entity) query = query.eq('entity', filters.entity)
  if (filters.action) query = query.eq('action', filters.action)

  // One extra row is fetched purely to learn whether there are more.
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(AUDIT_PAGE_SIZE + 1)

  if (error) throw new Error(error.message)

  const rows = (data ?? []) as AuditRow[]
  const truncated = rows.length > AUDIT_PAGE_SIZE
  const page = truncated ? rows.slice(0, AUDIT_PAGE_SIZE) : rows

  const actorIds = [...new Set(page.map((row) => row.actor_id).filter((id): id is string => !!id))]
  const actors = new Map<string, { full_name: string | null; email: string }>()

  if (actorIds.length > 0) {
    // Same-org operators only, per users_select_same_org. An actor outside the
    // caller's org simply does not resolve — which cannot happen, since the row
    // itself is org-scoped, but the code does not depend on that being true.
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, full_name, email')
      .in('id', actorIds)

    if (usersError) throw new Error(usersError.message)
    for (const user of users ?? []) {
      actors.set(user.id, { full_name: user.full_name, email: user.email })
    }
  }

  return {
    truncated,
    entries: page.map((row) => {
      const actor = row.actor_id ? actors.get(row.actor_id) : undefined
      return {
        id: row.id,
        createdAt: row.created_at,
        entity: row.entity,
        entityId: row.entity_id,
        action: row.action,
        oldValue: row.old_value,
        newValue: row.new_value,
        reason: row.reason,
        actorName: actor?.full_name || actor?.email || 'A removed account',
        actorEmail: actor?.email ?? null,
      }
    }),
  }
}
