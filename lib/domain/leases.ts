/**
 * Lease rules — pure functions, no IO.
 *
 * Two of the product's promises live in this file's shape:
 *
 *   AC2.1  two active leases can never overlap on one unit
 *   AC2.2  a unit is occupied because a lease says so, not because someone
 *          remembered to flip a switch
 *
 * Neither is ENFORCED here. Both are enforced in the database — by the EXCLUDE
 * constraint on `leases` and by `public.sync_unit_status_for()` respectively —
 * because a rule that only exists in application code is a rule that a direct
 * API call walks straight past. What lives here is the same arithmetic, run
 * before the write, so the screen can explain the collision in a sentence
 * instead of surfacing a raw SQLSTATE.
 *
 * MIRROR WARNING
 * ──────────────
 * `occupiesOn` reproduces `public.sync_unit_status_for` from
 * supabase/migrations/20260825000900_invariants_and_rpc.sql, and `termsOverlap`
 * reproduces the `daterange(start_date, end_date, '[]') &&` half of the EXCLUDE
 * constraint in ...000300_tables_assets.sql. The database copies are
 * authoritative. Change one, change the other, and re-run BOTH:
 *   pnpm test      (tests/unit/leases.test.ts)
 *   pnpm test:rls  (supabase/tests/assets_lifecycle.test.sql)
 *
 * Dates are 'YYYY-MM-DD' strings compared with < and >. For this format
 * lexicographic order IS chronological order, and it sidesteps the timezone
 * off-by-one that Date comparison invites — a lease must not end an evening
 * early because the reader sits west of UTC.
 */

/** A calendar date as 'YYYY-MM-DD'. */
export type IsoDate = string

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Billing days stop at 28 so the day exists in every month, February included.
 * Mirrors the `billing_day between 1 and 28` check on public.leases.
 */
export const MIN_BILLING_DAY = 1
export const MAX_BILLING_DAY = 28

export type LeaseStatus = 'active' | 'ended'
export type UnitStatus = 'vacant' | 'occupied'

/** The part of a lease that decides overlap and occupancy. */
export interface LeaseTerm {
  status: LeaseStatus
  startDate: IsoDate
  /** null means open-ended — the lease runs until someone ends it. */
  endDate: IsoDate | null
}

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return false
  // Rejects '2026-02-31': the round trip through Date only survives real dates.
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Today in UTC, matching the database's `current_date`. */
export function todayIso(now: Date = new Date()): IsoDate {
  return now.toISOString().slice(0, 10)
}

/**
 * Do two lease terms cover any day in common?
 *
 * Both ends are inclusive and a null end date is unbounded, exactly like
 * `daterange(start_date, end_date, '[]')`. Two leases that meet end-to-start on
 * the SAME day therefore do overlap — the outgoing resident and the incoming
 * one cannot both hold the keys on the 30th.
 */
export function termsOverlap(a: Pick<LeaseTerm, 'startDate' | 'endDate'>, b: Pick<LeaseTerm, 'startDate' | 'endDate'>): boolean {
  const aEndsBeforeBStarts = a.endDate !== null && a.endDate < b.startDate
  const bEndsBeforeAStarts = b.endDate !== null && b.endDate < a.startDate
  return !aEndsBeforeBStarts && !bEndsBeforeAStarts
}

/**
 * Is this lease putting someone in the unit on the given day?
 *
 * Note what this is NOT: `status === 'active'`. A lease signed today that
 * starts next month is active and yet the unit is empty until then, and the
 * database agrees — which is why creating a future lease correctly leaves the
 * unit vacant, and why the lease screen says so rather than letting a landlord
 * wonder whether the save worked.
 */
export function occupiesOn(lease: LeaseTerm, asOf: IsoDate = todayIso()): boolean {
  if (lease.status !== 'active') return false
  if (lease.startDate > asOf) return false
  return lease.endDate === null || lease.endDate >= asOf
}

/** The unit status implied by a set of leases, mirroring the database trigger. */
export function unitStatusFromLeases(leases: LeaseTerm[], asOf: IsoDate = todayIso()): UnitStatus {
  return leases.some((lease) => occupiesOn(lease, asOf)) ? 'occupied' : 'vacant'
}

/**
 * The active lease that a candidate term would collide with, or null.
 *
 * Only the collision the DATABASE would raise counts, so ended leases are
 * ignored — the EXCLUDE constraint carries `where (status = 'active')`.
 * Pass `excludeLeaseId` when editing, or a lease will be found to conflict
 * with itself.
 */
export function findConflictingLease<T extends LeaseTerm & { id: string }>(
  existing: T[],
  candidate: Pick<LeaseTerm, 'startDate' | 'endDate'>,
  excludeLeaseId?: string,
): T | null {
  return (
    existing.find(
      (lease) =>
        lease.status === 'active' &&
        lease.id !== excludeLeaseId &&
        termsOverlap(lease, candidate),
    ) ?? null
  )
}

// ---------------------------------------------------------------------------
// Validation
//
// Every rule below is also a database constraint. These exist to put the
// message next to the field rather than to be the defence.
// ---------------------------------------------------------------------------

export interface LeaseDraft {
  unitId: string
  tenantId: string
  startDate: string
  endDate: string | null
  rentCents: number | null
  depositCents: number | null
  billingDay: number
}

export interface FieldIssue {
  field: keyof LeaseDraft
  message: string
}

export function validateLeaseDraft(draft: LeaseDraft): FieldIssue[] {
  const issues: FieldIssue[] = []

  if (!draft.unitId) issues.push({ field: 'unitId', message: 'Choose the unit this lease covers.' })
  if (!draft.tenantId) issues.push({ field: 'tenantId', message: 'Choose the resident.' })

  if (!isIsoDate(draft.startDate)) {
    issues.push({ field: 'startDate', message: 'Enter a start date.' })
  }

  if (draft.endDate !== null && draft.endDate !== '') {
    if (!isIsoDate(draft.endDate)) {
      issues.push({ field: 'endDate', message: 'Enter a valid end date, or leave it open-ended.' })
    } else if (isIsoDate(draft.startDate) && draft.endDate < draft.startDate) {
      issues.push({ field: 'endDate', message: 'The end date cannot come before the start date.' })
    }
  }

  if (draft.rentCents === null || !Number.isInteger(draft.rentCents) || draft.rentCents < 0) {
    issues.push({ field: 'rentCents', message: 'Enter the monthly rent, for example 1200.00.' })
  }

  if (
    draft.depositCents === null ||
    !Number.isInteger(draft.depositCents) ||
    draft.depositCents < 0
  ) {
    issues.push({ field: 'depositCents', message: 'Enter the deposit, or 0 if there is none.' })
  }

  if (
    !Number.isInteger(draft.billingDay) ||
    draft.billingDay < MIN_BILLING_DAY ||
    draft.billingDay > MAX_BILLING_DAY
  ) {
    issues.push({
      field: 'billingDay',
      message: `Pick a billing day between ${MIN_BILLING_DAY} and ${MAX_BILLING_DAY} — every month has those days.`,
    })
  }

  return issues
}

/**
 * Ending a lease is a date, not just a flag: the end date is what stops the
 * unit blocking the next lease, so it has to be a real day on or after the
 * start.
 */
export function validateLeaseEnd(lease: LeaseTerm, endDate: string): string | null {
  if (lease.status !== 'active') return 'This lease has already ended.'
  if (!isIsoDate(endDate)) return 'Enter the date the lease ends.'
  if (endDate < lease.startDate) return 'A lease cannot end before it started.'
  return null
}

// ---------------------------------------------------------------------------
// Occupancy (AC1.1)
// ---------------------------------------------------------------------------

export interface OccupancySummary {
  total: number
  occupied: number
  vacant: number
  /** 0–100, rounded to a whole number. A portfolio with no units reads 0. */
  percent: number
}

/**
 * Occupancy across a set of units.
 *
 * This is the number a landlord checks first in the morning, so it is derived
 * from the unit rows rather than cached anywhere: the moment a lease moves a
 * unit, the next read of this function tells the truth (AC1.1).
 */
export function occupancySummary(units: Array<{ status: UnitStatus }>): OccupancySummary {
  const total = units.length
  const occupied = units.filter((unit) => unit.status === 'occupied').length
  return {
    total,
    occupied,
    vacant: total - occupied,
    percent: total === 0 ? 0 : Math.round((occupied / total) * 100),
  }
}

/** 'August 2026 – open-ended' style label for a lease term. */
export function formatTerm(
  term: Pick<LeaseTerm, 'startDate' | 'endDate'>,
  locale = 'en-US',
): string {
  const start = formatIsoDate(term.startDate, locale)
  return term.endDate === null ? `${start} – open-ended` : `${start} – ${formatIsoDate(term.endDate, locale)}`
}

/** Formats '2026-08-25' as 'Aug 25, 2026', read in UTC so the day never shifts. */
export function formatIsoDate(date: IsoDate, locale = 'en-US'): string {
  if (!isIsoDate(date)) return date
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}
