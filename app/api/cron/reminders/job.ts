/**
 * The daily reminder job (F6) — orchestration only. The rule for WHICH
 * reminders are due lives in lib/domain/reminders.ts and is unit-tested there;
 * this file reads invoices, asks that rule, and sends what it returns.
 *
 * It runs with the service-role client because it acts across every
 * organization and has no user session — the one legitimate reason to bypass
 * RLS (see lib/supabase/admin.ts). Being cross-org, it owns its own tenancy:
 * every write carries the invoice's own org_id.
 *
 * Two acceptance criteria are load-bearing here:
 *
 *   AC6.1  a paid invoice is never chased. The status is re-read from the
 *          database (after refresh_overdue_invoices runs) at the moment of
 *          sending, and remindersDue() returns nothing for a paid invoice —
 *          so the check is at SEND time, not schedule time.
 *   AC6.2  running twice in a day sends nothing the second time. The log row
 *          is inserted BEFORE the email is sent; its UNIQUE (invoice_id, kind)
 *          turns a re-run into a no-op. A duplicate insert is caught and the
 *          send is skipped — so "ran once" and "ran twice" look identical to a
 *          resident.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { getNotificationProvider } from '@/lib/notifications/providers'
import type { NotificationProvider } from '@/lib/notifications/types'
import {
  buildReminderEmail,
  type ReminderLine,
} from '@/lib/notifications/templates/reminders'
import { remindersDue, type ReminderKind } from '@/lib/domain/reminders'
import { todayUtc, type InvoiceStatus } from '@/lib/domain/invoice-status'
import { APP_URL } from '@/lib/env'
import type { Json } from '@/lib/types/database'

/** Postgres unique-violation SQLSTATE — the idempotency signal (AC6.2). */
const UNIQUE_VIOLATION = '23505'

/** Statuses a reminder may concern. Excludes 'draft' and 'paid' at the query. */
const CHASEABLE_STATUSES: InvoiceStatus[] = ['sent', 'partial', 'overdue']

export interface ReminderJobSummary {
  asOf: string
  /** Invoices moved to 'overdue' by refresh_overdue_invoices this run (AC6.3). */
  refreshedOverdue: number
  /** Invoices examined for reminders. */
  considered: number
  /** Reminders actually sent this run. */
  sent: Array<{ invoiceId: string; kind: ReminderKind }>
  /** Reminders skipped because they were already logged (AC6.2). */
  duplicates: number
  /** Due reminders whose invoice has no email on file — nothing sent, nothing logged. */
  skippedNoRecipient: number
  /** Reminders whose log row was written but the provider failed to deliver. */
  failed: Array<{ invoiceId: string; kind: ReminderKind; error: string }>
}

interface CandidateRow {
  id: string
  org_id: string
  period: string
  due_date: string
  status: InvoiceStatus
  total_cents: number
  paid_cents: number
  breakdown: Json
  organizations: { currency: string } | null
  leases: {
    units: { code: string; properties: { name: string } | null } | null
    tenants: { full_name: string; email: string | null } | null
  } | null
}

const CANDIDATE_SELECT = `
  id, org_id, period, due_date, status, total_cents, paid_cents, breakdown,
  organizations!inner ( currency ),
  leases!inner (
    units!inner ( code, properties!inner ( name ) ),
    tenants!inner ( full_name, email )
  )
`

/** Turns the stored breakdown JSON into display lines, without recomputing money. */
function linesFrom(breakdown: Json): ReminderLine[] {
  if (!Array.isArray(breakdown)) return []
  const lines: ReminderLine[] = []
  for (const entry of breakdown) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const label = (entry as Record<string, unknown>).label
      const amount = (entry as Record<string, unknown>).amount_cents
      if (typeof label === 'string' && typeof amount === 'number') {
        lines.push({ label, amountCents: amount })
      }
    }
  }
  return lines
}

export async function runReminderJob(options: {
  asOf?: string
  provider?: NotificationProvider
} = {}): Promise<ReminderJobSummary> {
  const asOf = options.asOf ?? todayUtc()
  const provider = options.provider ?? getNotificationProvider()
  const supabase = createAdminClient()

  const summary: ReminderJobSummary = {
    asOf,
    refreshedOverdue: 0,
    considered: 0,
    sent: [],
    duplicates: 0,
    skippedNoRecipient: 0,
    failed: [],
  }

  // Step 1 — move newly-late invoices to 'overdue' for this as_of (AC6.3).
  const { data: refreshed, error: refreshError } = await supabase.rpc(
    'refresh_overdue_invoices',
    { p_as_of: asOf },
  )
  if (refreshError) {
    throw new Error(`refresh_overdue_invoices failed: ${refreshError.message}`)
  }
  summary.refreshedOverdue = refreshed ?? 0

  // Step 2 — the invoices that could need a reminder, with their status now current.
  const { data, error } = await supabase
    .from('invoices')
    .select(CANDIDATE_SELECT)
    .in('status', CHASEABLE_STATUSES)
  if (error) {
    throw new Error(`loading reminder candidates failed: ${error.message}`)
  }

  const rows = (data as unknown as CandidateRow[] | null) ?? []
  summary.considered = rows.length

  for (const row of rows) {
    const kinds = remindersDue({ status: row.status, dueDate: row.due_date }, asOf)
    if (kinds.length === 0) continue

    const tenant = row.leases?.tenants
    const recipient = tenant?.email ?? null

    for (const kind of kinds) {
      if (!recipient) {
        // No address: send nothing AND log nothing, so a reminder can still go
        // out once an email is added rather than being silently marked sent.
        summary.skippedNoRecipient += 1
        continue
      }

      // Log first (AC6.2). A conflict means a prior run already handled it.
      const { error: logError } = await supabase.from('reminder_logs').insert({
        org_id: row.org_id,
        invoice_id: row.id,
        kind,
        channel: 'email',
        recipient,
      })
      if (logError) {
        if (logError.code === UNIQUE_VIOLATION) {
          summary.duplicates += 1
          continue
        }
        throw new Error(`writing reminder_logs failed: ${logError.message}`)
      }

      const email = buildReminderEmail({
        kind,
        invoice: {
          id: row.id,
          period: row.period,
          dueDate: row.due_date,
          totalCents: row.total_cents,
          paidCents: row.paid_cents,
        },
        currency: row.organizations?.currency ?? 'USD',
        lines: linesFrom(row.breakdown),
        unitCode: row.leases?.units?.code ?? '',
        propertyName: row.leases?.units?.properties?.name ?? '',
        tenantName: tenant?.full_name ?? 'there',
        recipientEmail: recipient,
        appUrl: APP_URL,
      })

      const result = await provider.send(email)
      if (result.delivered) {
        summary.sent.push({ invoiceId: row.id, kind })
      } else {
        // The log row stays: AC6.2 (never double-send) outranks retrying a
        // failed delivery. The failure is surfaced so a run can be inspected.
        summary.failed.push({ invoiceId: row.id, kind, error: result.error ?? 'unknown' })
      }
    }
  }

  return summary
}
