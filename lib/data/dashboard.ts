/**
 * The operator overview (AC-D1).
 *
 * Every query here runs through the user's own Supabase client, so RLS scopes
 * it to the caller's organization — the dashboard never uses the service role.
 * That is the whole reason the numbers are safe to show without a manual
 * org_id filter: the database already refuses another org's rows.
 *
 * Money is read from the trigger-computed columns (total_cents, paid_cents),
 * never re-summed from a breakdown. Occupancy is derived from units.status,
 * which the lease triggers keep in step (AC1.1 / AC2.2), so "12 of 15 occupied"
 * always matches what the units screen shows.
 */

import { createClient } from '@/lib/supabase/server'
import { currentPeriod, type Period } from '@/lib/domain/period'
import { todayUtc } from '@/lib/domain/invoice-status'
import { addDays } from '@/lib/domain/reminders'

/** Leases ending within this many days are surfaced. Grouped 30 / 60 in the UI. */
const EXPIRY_HORIZON_DAYS = 60

const MS_PER_DAY = 86_400_000

export interface DashboardMoney {
  period: Period
  /** Σ total_cents of the period's issued invoices. */
  billedCents: number
  /** Σ paid_cents of the period's issued invoices. */
  collectedCents: number
  /** billed − collected, never negative. */
  outstandingCents: number
}

export interface DashboardOccupancy {
  occupied: number
  total: number
  /** Whole-percent occupancy, 0 when there are no units. */
  ratePercent: number
}

export interface ExpiringLease {
  id: string
  unitCode: string
  tenantName: string
  /** 'YYYY-MM-DD' */
  endDate: string
  daysLeft: number
  /** Which bucket it falls in — leases due soonest first. */
  within: 30 | 60
}

export interface OverdueUnit {
  invoiceId: string
  unitCode: string
  tenantName: string
  period: string
  /** 'YYYY-MM-DD' */
  dueDate: string
  outstandingCents: number
}

export interface DashboardSummary {
  money: DashboardMoney
  occupancy: DashboardOccupancy
  expiringLeases: ExpiringLease[]
  overdueUnits: OverdueUnit[]
}

interface LeaseJoinRow {
  id: string
  end_date: string | null
  units: { code: string } | null
  tenants: { full_name: string } | null
}

interface OverdueJoinRow {
  id: string
  period: string
  due_date: string
  total_cents: number
  paid_cents: number
  leases: {
    units: { code: string } | null
    tenants: { full_name: string } | null
  } | null
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number]
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY)
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const supabase = await createClient()
  const period = currentPeriod()
  const today = todayUtc()
  const horizon = addDays(today, EXPIRY_HORIZON_DAYS)

  const [monthInvoices, units, leases, overdue] = await Promise.all([
    supabase
      .from('invoices')
      .select('total_cents, paid_cents, issued_at')
      .eq('period', period)
      .not('issued_at', 'is', null),
    supabase.from('units').select('status'),
    supabase
      .from('leases')
      .select('id, end_date, units!inner(code), tenants!inner(full_name)')
      .eq('status', 'active')
      .not('end_date', 'is', null)
      .gte('end_date', today)
      .lte('end_date', horizon)
      .order('end_date', { ascending: true }),
    supabase
      .from('invoices')
      .select(
        'id, period, due_date, total_cents, paid_cents, leases!inner(units!inner(code), tenants!inner(full_name))',
      )
      .eq('status', 'overdue')
      .order('due_date', { ascending: true }),
  ])

  if (monthInvoices.error) throw new Error(monthInvoices.error.message)
  if (units.error) throw new Error(units.error.message)
  if (leases.error) throw new Error(leases.error.message)
  if (overdue.error) throw new Error(overdue.error.message)

  const billedCents = (monthInvoices.data ?? []).reduce((sum, row) => sum + row.total_cents, 0)
  const collectedCents = (monthInvoices.data ?? []).reduce((sum, row) => sum + row.paid_cents, 0)

  const total = units.data?.length ?? 0
  const occupied = (units.data ?? []).filter((row) => row.status === 'occupied').length

  const expiringLeases: ExpiringLease[] = ((leases.data as LeaseJoinRow[] | null) ?? []).map(
    (row) => {
      const endDate = row.end_date as string
      const daysLeft = daysBetween(today, endDate)
      return {
        id: row.id,
        unitCode: row.units?.code ?? '',
        tenantName: row.tenants?.full_name ?? '',
        endDate,
        daysLeft,
        within: daysLeft <= 30 ? 30 : 60,
      }
    },
  )

  const overdueUnits: OverdueUnit[] = ((overdue.data as OverdueJoinRow[] | null) ?? []).map(
    (row) => ({
      invoiceId: row.id,
      unitCode: row.leases?.units?.code ?? '',
      tenantName: row.leases?.tenants?.full_name ?? '',
      period: row.period,
      dueDate: row.due_date,
      outstandingCents: Math.max(0, row.total_cents - row.paid_cents),
    }),
  )

  return {
    money: {
      period,
      billedCents,
      collectedCents,
      outstandingCents: Math.max(0, billedCents - collectedCents),
    },
    occupancy: {
      occupied,
      total,
      ratePercent: total === 0 ? 0 : Math.round((occupied / total) * 100),
    },
    expiringLeases,
    overdueUnits,
  }
}
