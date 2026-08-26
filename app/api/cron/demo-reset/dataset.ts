/**
 * The demo organization's data, as a pure function of one date (D23).
 *
 * No IO, no clock, no randomness: give it the same anchor day and it returns
 * byte-identical rows, ids included. That is what makes the nightly reset
 * idempotent in the way that matters — running it twice leaves the database in
 * the state one run leaves it in, not merely "in some valid state".
 *
 * WHY DATES ARE OFFSETS FROM THE ANCHOR, NOT `billing_day` ARITHMETIC
 * The demo has to show all four live invoice statuses — paid, partial, overdue
 * and sent — on every day of the year. Status is a function of due_date versus
 * today (30-data-model.md), so due dates derived from a billing day would drift
 * across the month: an invoice due on the 5th is "overdue" on the 26th and
 * "sent" on the 2nd, and the demo would quietly lose a status for a week each
 * month. Fixed offsets from the anchor pin every status in place. Leases still
 * carry a realistic `billing_day`; it is simply not what these due dates are
 * computed from.
 *
 * THE THREE D23 CONSTRAINTS, AND WHERE THEY LIVE
 *   1. Every resident email is @example.com — a reserved domain that cannot
 *      receive mail (RFC 2606). The nightly reminder job runs across every org
 *      including this one, so fake data must be unable to reach a real inbox.
 *      Enforced here, and asserted in tests/unit/demo-dataset.test.ts.
 *   2. The subscription never trial-expires: status 'active' on the top plan
 *      with a period_end far in the future, re-asserted on every reset so the
 *      demo cannot lock itself out by drifting.
 *   3. Deletes are scoped to the demo org id — that belongs to reset.ts, which
 *      is the only file that writes.
 *
 * A FOURTH PROPERTY, WORTH KNOWING ABOUT
 * No due date lands in a reminder window (due−3, due+1, due+7) on the anchor
 * day, so a fresh reset never makes the reminder job send anything at all.
 * Constraint 1 is the guarantee; this is the belt to its braces.
 */

import { buildInvoiceDraft, type InvoiceDraft, type TariffSnapshot } from '@/lib/domain/billing'
import { periodOf, previousPeriod, type Period } from '@/lib/domain/period'
import type { Breakdown } from '@/lib/domain/breakdown'

/** Fixed so every delete in reset.ts can name it, and so seed.sql agrees. */
export const DEMO_ORG_ID = 'd0000000-0000-4000-8000-000000000001'
export const DEMO_ORG_NAME = 'Riverbend Residential (demo)'
export const DEMO_OWNER_ID = 'd0000000-0000-4000-8000-000000000010'
export const DEMO_MANAGER_ID = 'd0000000-0000-4000-8000-000000000011'
export const DEMO_OWNER_EMAIL = 'demo-owner@example.com'
export const DEMO_MANAGER_EMAIL = 'demo-manager@example.com'

/** D23 constraint 1. Reserved by RFC 2606 — mail to it cannot be delivered. */
export const DEMO_EMAIL_DOMAIN = '@example.com'

/** D23 constraint 2 — a date the demo will never reach. */
export const DEMO_PERIOD_END = '2099-12-31T00:00:00Z'
export const DEMO_PLAN = 'pro'
export const DEMO_SUBSCRIPTION_STATUS = 'active'

/**
 * Due-date offsets from the anchor, oldest first.
 *
 * The last one is in the future, which is what makes 'sent' and 'partial'
 * reachable at all; the rest are far enough in the past that an unpaid invoice
 * is unambiguously overdue. The margins are wide on purpose — the reminder job
 * re-derives every invoice's status for whatever `as_of` it is called with, and
 * the e2e suite calls it with dates a couple of weeks either side of today
 * against this same shared database. Offsets of a day or two would let another
 * suite's run quietly restage the demo.
 *
 * The cost is that a period's label and its due date drift apart by a few weeks
 * depending on the day of the month — August's bill is not always due in
 * September here. That is a cosmetic imperfection in a demo, traded for an
 * invariant that is not cosmetic: all four statuses, on every day of the year.
 */
const DUE_OFFSETS = [-100, -70, -40, 18] as const

const MS_PER_DAY = 86_400_000

/** 'YYYY-MM-DD' shifted by whole days, in UTC. */
export function shiftDay(day: string, days: number): string {
  const base = new Date(`${day}T00:00:00Z`).getTime()
  return new Date(base + days * MS_PER_DAY).toISOString().slice(0, 10)
}

/** The earlier of two 'YYYY-MM-DD' days — lexicographic order is chronological. */
function earlier(a: string, b: string): string {
  return a < b ? a : b
}

/** A stable uuid: one group per table, one index per row. */
function demoId(group: string, index: number): string {
  return `d0000000-0000-4000-8000-${group}${String(index).padStart(9, '0')}`
}

const IDS = {
  property: (n: number) => demoId('100', n),
  unit: (n: number) => demoId('200', n),
  tenant: (n: number) => demoId('300', n),
  lease: (n: number) => demoId('400', n),
  invoice: (n: number) => demoId('500', n),
  maintenance: (n: number) => demoId('600', n),
  payment: (n: number) => demoId('700', n),
  reading: (n: number) => demoId('800', n),
  tariff: (n: number) => demoId('900', n),
}

// ---------------------------------------------------------------------------
// The portfolio. Written out rather than generated so the demo reads like a
// real small landlord's books and not like a fixture.
// ---------------------------------------------------------------------------

interface UnitSpec {
  code: string
  area: number
  rentCents: number
  /** Index into PROPERTIES. */
  property: number
}

const PROPERTIES = [
  { name: 'Riverbend Apartments', address: '2200 Riverbend Dr, Austin, TX 78741' },
  { name: 'Maple Row Duplexes', address: '17 Maple Row, Austin, TX 78702' },
  { name: 'Harbor Lofts', address: '404 Harbor St, Austin, TX 78703' },
] as const

const UNITS: readonly UnitSpec[] = [
  { code: '101', area: 52.0, rentCents: 118000, property: 0 },
  { code: '102', area: 52.0, rentCents: 118000, property: 0 },
  { code: '103', area: 46.5, rentCents: 104000, property: 0 },
  { code: '201', area: 58.0, rentCents: 129000, property: 0 },
  { code: '202', area: 58.0, rentCents: 129000, property: 0 },
  { code: '203', area: 46.5, rentCents: 106000, property: 0 },
  { code: '1A', area: 71.0, rentCents: 152000, property: 1 },
  { code: '1B', area: 71.0, rentCents: 152000, property: 1 },
  { code: '2A', area: 68.0, rentCents: 146000, property: 1 },
  { code: '2B', area: 68.0, rentCents: 146000, property: 1 },
  { code: 'L1', area: 88.0, rentCents: 185000, property: 2 },
  { code: 'L2', area: 84.0, rentCents: 178000, property: 2 },
  { code: 'L3', area: 84.0, rentCents: 178000, property: 2 },
]

/**
 * Residents, in unit order. The first eleven hold the live leases; the last two
 * are former residents, which is what gives the demo a lease history instead of
 * a portfolio that looks like it was created this morning.
 */
const RESIDENT_NAMES = [
  'Amara Osei',
  'Ben Kowalski',
  'Clara Nunes',
  'Devin Park',
  'Elena Ruiz',
  'Felix Andersen',
  'Grace Mbeki',
  'Hugo Lindqvist',
  'Iris Nakamura',
  'Jonas Weber',
  'Keiko Tanaka',
  'Liam Doherty', // former resident of unit 101
  'Maya Castellanos', // former resident of unit L2 — that unit is now vacant
] as const

/** Units 12 and 13 (L2, L3) stay empty, so occupancy is a real number, not 100%. */
const ACTIVE_LEASE_COUNT = 11

const DEMO_TARIFF: TariffSnapshot = {
  electricRatePerKwh: 0.142,
  waterRatePerUnit: 0.0135,
  serviceFeeCents: 3500,
  // Far enough back that every demo period is priced; D17 refuses to issue
  // without a rate card, and the demo must never hit that refusal.
  effectiveFrom: '2020-01-01',
}

/** Meter consumption per period, per unit — a fixed pattern, never random. */
const ELECTRIC_BASE = 310
const WATER_BASE = 1450

// ---------------------------------------------------------------------------
// Row shapes. Deliberately snake_case: these go straight to the table.
// ---------------------------------------------------------------------------

export interface DemoProperty {
  id: string
  org_id: string
  name: string
  address: string
}

export interface DemoUnit {
  id: string
  org_id: string
  property_id: string
  code: string
  area: number
  base_rent_cents: number
}

export interface DemoTenant {
  id: string
  org_id: string
  full_name: string
  phone: string
  email: string
}

export interface DemoLease {
  id: string
  org_id: string
  unit_id: string
  tenant_id: string
  start_date: string
  end_date: string | null
  rent_cents: number
  deposit_cents: number
  billing_day: number
  status: 'active' | 'ended'
}

export interface DemoTariff {
  id: string
  org_id: string
  electric_rate_per_kwh: number
  water_rate_per_unit: number
  service_fee_cents: number
  effective_from: string
}

export interface DemoReading {
  id: string
  org_id: string
  unit_id: string
  period: string
  electric_prev: number
  electric_curr: number
  water_prev: number
  water_curr: number
  recorded_by: string
}

export interface DemoInvoice {
  id: string
  org_id: string
  lease_id: string
  period: string
  rent_cents: number
  electric_cents: number
  water_cents: number
  service_cents: number
  other_cents: number
  breakdown: Breakdown
  due_date: string
  issued_at: string
  /** Not written — status and totals are derived by the trigger (D10). Kept for tests. */
  expectedTotalCents: number
}

export interface DemoPayment {
  id: string
  org_id: string
  invoice_id: string
  amount_cents: number
  paid_at: string
  method: 'cash' | 'bank_transfer'
  note: string | null
  recorded_by: string
}

export interface DemoMaintenance {
  id: string
  org_id: string
  unit_id: string
  tenant_id: string
  title: string
  description: string
  status: 'submitted' | 'in_progress' | 'done'
}

export interface DemoDataset {
  /** 'YYYY-MM-DD' the whole set is computed from. */
  anchor: string
  /** The four periods being demonstrated, oldest first. */
  periods: Period[]
  properties: DemoProperty[]
  units: DemoUnit[]
  tenants: DemoTenant[]
  leases: DemoLease[]
  tariffs: DemoTariff[]
  readings: DemoReading[]
  invoices: DemoInvoice[]
  payments: DemoPayment[]
  maintenance: DemoMaintenance[]
}

function emailFor(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')
  return `${slug}${DEMO_EMAIL_DOMAIN}`
}

/** '+1-512-555-0101' … a stable, obviously fictional US number (555 range). */
function phoneFor(index: number): string {
  return `+1-512-555-${String(1000 + index).slice(-4)}`
}

/**
 * How each (lease, period) is settled.
 *
 * Read as a table rather than as branching logic, because the point of it is
 * coverage: every one of the four statuses has to appear, and the partial-but-
 * late case has to appear too, since "overdue outranks partial" (AC5.1) is the
 * rule most easily got wrong and most worth showing.
 */
type Settlement = 'full' | 'partial' | 'none'

function settlementFor(leaseIndex: number, periodIndex: number): Settlement {
  const isCurrent = periodIndex === DUE_OFFSETS.length - 1
  const isLastPast = periodIndex === DUE_OFFSETS.length - 2

  if (isCurrent) {
    // Due in the future: unpaid reads 'sent', part-paid reads 'partial'.
    if (leaseIndex === 3 || leaseIndex === 4) return 'partial'
    if (leaseIndex === 5) return 'full'
    return 'none'
  }

  if (isLastPast) {
    // Past due: unpaid reads 'overdue'. Lease 2 is the showcase — money came in,
    // the invoice is still late, and the status stays 'overdue' (AC5.1).
    if (leaseIndex === 0 || leaseIndex === 1) return 'none'
    if (leaseIndex === 2) return 'partial'
    return 'full'
  }

  // Everything older is settled, so the history looks like a business that works.
  return 'full'
}

/**
 * Consumption for a unit in a period: a fixed spread, no randomness.
 *
 * The pattern varies by unit and by period so the meter screen and the invoice
 * breakdowns have something to show, and it never decreases — a rolled-over
 * meter would raise a flag that the demo does not want to explain.
 */
function consumptionFor(unitIndex: number, periodIndex: number): { electric: number; water: number } {
  return {
    electric: ELECTRIC_BASE + unitIndex * 17 + periodIndex * 23,
    water: WATER_BASE + unitIndex * 40 + periodIndex * 55,
  }
}

export function buildDemoDataset(anchor: string): DemoDataset {
  const anchorDate = new Date(`${anchor}T00:00:00Z`)

  // The four periods on show, oldest first, ending with the current month.
  const periods: Period[] = []
  let period: Period = periodOf(anchorDate)
  for (let i = 0; i < DUE_OFFSETS.length; i += 1) {
    periods.unshift(period)
    period = previousPeriod(period)
  }

  const properties: DemoProperty[] = PROPERTIES.map((spec, index) => ({
    id: IDS.property(index + 1),
    org_id: DEMO_ORG_ID,
    name: spec.name,
    address: spec.address,
  }))

  const units: DemoUnit[] = UNITS.map((spec, index) => ({
    id: IDS.unit(index + 1),
    org_id: DEMO_ORG_ID,
    property_id: properties[spec.property]!.id,
    code: spec.code,
    area: spec.area,
    base_rent_cents: spec.rentCents,
  }))

  const tenants: DemoTenant[] = RESIDENT_NAMES.map((name, index) => ({
    id: IDS.tenant(index + 1),
    org_id: DEMO_ORG_ID,
    full_name: name,
    phone: phoneFor(index + 1),
    email: emailFor(name),
  }))

  const tariffs: DemoTariff[] = [
    {
      id: IDS.tariff(1),
      org_id: DEMO_ORG_ID,
      electric_rate_per_kwh: DEMO_TARIFF.electricRatePerKwh,
      water_rate_per_unit: DEMO_TARIFF.waterRatePerUnit,
      service_fee_cents: DEMO_TARIFF.serviceFeeCents,
      effective_from: DEMO_TARIFF.effectiveFrom,
    },
  ]

  // --- leases ------------------------------------------------------------
  // Eleven live leases, then two that ended. The ended pair is what makes the
  // demo honest: one unit was re-let (its history survives the changeover) and
  // one is standing empty.
  const leases: DemoLease[] = []

  for (let i = 0; i < ACTIVE_LEASE_COUNT; i += 1) {
    leases.push({
      id: IDS.lease(i + 1),
      org_id: DEMO_ORG_ID,
      unit_id: units[i]!.id,
      tenant_id: tenants[i]!.id,
      // Well before the oldest period on show, so every lease is billable for
      // all four months and leaseCoversPeriod() never trims one silently.
      start_date: shiftDay(anchor, -540 + i * 7),
      end_date: null,
      rent_cents: units[i]!.base_rent_cents,
      deposit_cents: units[i]!.base_rent_cents,
      billing_day: 12,
      status: 'active',
    })
  }

  // Liam held unit 101 before Amara. It ended before her lease began, so the
  // exclusion constraint on overlapping active leases is satisfied by the
  // dates as well as by the status.
  leases.push({
    id: IDS.lease(90),
    org_id: DEMO_ORG_ID,
    unit_id: units[0]!.id,
    tenant_id: tenants[11]!.id,
    start_date: shiftDay(anchor, -1000),
    end_date: shiftDay(anchor, -545),
    rent_cents: 110000,
    deposit_cents: 110000,
    billing_day: 12,
    status: 'ended',
  })

  // Maya moved out of L2 recently enough to still have invoices on file — which
  // is the case an operator actually needs: a closed lease whose money history
  // must not disappear with it.
  const endedRecentIndex = 11 // unit L2
  leases.push({
    id: IDS.lease(91),
    org_id: DEMO_ORG_ID,
    unit_id: units[endedRecentIndex]!.id,
    tenant_id: tenants[12]!.id,
    start_date: shiftDay(anchor, -700),
    end_date: shiftDay(anchor, -75),
    rent_cents: units[endedRecentIndex]!.base_rent_cents,
    deposit_cents: units[endedRecentIndex]!.base_rent_cents,
    billing_day: 12,
    status: 'ended',
  })

  // --- meter readings ----------------------------------------------------
  // Every unit is metered, let or not: a vacant unit still has a meter, and the
  // reading screen should show it that way.
  const readings: DemoReading[] = []
  let readingSeq = 0

  for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
    let electric = 4000 + unitIndex * 250
    let water = 9000 + unitIndex * 600

    for (let periodIndex = 0; periodIndex < periods.length; periodIndex += 1) {
      const used = consumptionFor(unitIndex, periodIndex)
      const electricPrev = electric
      const waterPrev = water
      electric += used.electric
      water += used.water

      readingSeq += 1
      readings.push({
        id: IDS.reading(readingSeq),
        org_id: DEMO_ORG_ID,
        unit_id: units[unitIndex]!.id,
        period: periods[periodIndex]!,
        electric_prev: electricPrev,
        electric_curr: electric,
        water_prev: waterPrev,
        water_curr: water,
        recorded_by: DEMO_MANAGER_ID,
      })
    }
  }

  const readingFor = (unitId: string, forPeriod: string) =>
    readings.find((row) => row.unit_id === unitId && row.period === forPeriod) ?? null

  // --- invoices and payments --------------------------------------------
  const invoices: DemoInvoice[] = []
  const payments: DemoPayment[] = []
  let invoiceSeq = 0
  let paymentSeq = 0

  function issue(
    lease: DemoLease,
    periodIndex: number,
    settlement: Settlement,
  ): void {
    const forPeriod = periods[periodIndex]!
    const reading = readingFor(lease.unit_id, forPeriod)
    const dueDate = shiftDay(anchor, DUE_OFFSETS[periodIndex]!)

    // The same builder the real issue flow uses, so the demo's arithmetic and
    // its breakdown snapshot are the product's, not a second implementation.
    const draft: InvoiceDraft = buildInvoiceDraft({
      period: forPeriod,
      rentCents: lease.rent_cents,
      billingDay: lease.billing_day,
      tariff: DEMO_TARIFF,
      electric: reading ? { prev: reading.electric_prev, curr: reading.electric_curr } : null,
      water: reading ? { prev: reading.water_prev, curr: reading.water_curr } : null,
    })

    invoiceSeq += 1
    const invoiceId = IDS.invoice(invoiceSeq)

    invoices.push({
      id: invoiceId,
      org_id: DEMO_ORG_ID,
      lease_id: lease.id,
      period: forPeriod,
      rent_cents: draft.rentCents,
      electric_cents: draft.electricCents,
      water_cents: draft.waterCents,
      service_cents: draft.serviceCents,
      other_cents: draft.otherCents,
      breakdown: draft.breakdown,
      // Issued about a fortnight before it fell due, as a real month would be —
      // but never in the future. The newest invoice is due in eighteen days, and
      // an invoice stamped "issued next week" would read as a bug.
      issued_at: `${earlier(shiftDay(dueDate, -14), shiftDay(anchor, -1))}T09:00:00Z`,
      due_date: dueDate,
      expectedTotalCents: draft.totalCents,
    })

    if (settlement === 'none') return

    const amount =
      settlement === 'full'
        ? draft.totalCents
        : // A round-ish part payment that is unmistakably less than the total.
          Math.max(1, Math.round(draft.totalCents * 0.4))

    // Money arrives before the due date when the month is settled, and shortly
    // after it for the part payment on a late invoice — which is precisely why
    // that one still reads 'overdue' rather than 'partial' (AC5.1). Neither can
    // land in the future: a payment recorded next week is not a demo, it is a
    // puzzle.
    const paidOn =
      dueDate < anchor
        ? shiftDay(dueDate, settlement === 'full' ? -3 : 4)
        : shiftDay(anchor, settlement === 'full' ? -3 : -2)

    paymentSeq += 1
    payments.push({
      id: IDS.payment(paymentSeq),
      org_id: DEMO_ORG_ID,
      invoice_id: invoiceId,
      amount_cents: amount,
      paid_at: `${paidOn}T14:30:00Z`,
      method: paymentSeq % 2 === 0 ? 'cash' : 'bank_transfer',
      note: settlement === 'partial' ? 'Part payment — balance agreed for next month' : null,
      recorded_by: DEMO_MANAGER_ID,
    })
  }

  for (let leaseIndex = 0; leaseIndex < ACTIVE_LEASE_COUNT; leaseIndex += 1) {
    const lease = leases[leaseIndex]!
    for (let periodIndex = 0; periodIndex < periods.length; periodIndex += 1) {
      issue(lease, periodIndex, settlementFor(leaseIndex, periodIndex))
    }
  }

  // Maya's closed lease keeps the two months it was billed for, both settled.
  const endedLease = leases[leases.length - 1]!
  issue(endedLease, 0, 'full')
  issue(endedLease, 1, 'full')

  // --- maintenance -------------------------------------------------------
  const maintenance: DemoMaintenance[] = [
    {
      id: IDS.maintenance(1),
      org_id: DEMO_ORG_ID,
      unit_id: units[0]!.id,
      tenant_id: tenants[0]!.id,
      title: 'Kitchen tap drips overnight',
      description: 'Steady drip from the mixer tap even when fully closed. Worse at night.',
      status: 'submitted',
    },
    {
      id: IDS.maintenance(2),
      org_id: DEMO_ORG_ID,
      unit_id: units[3]!.id,
      tenant_id: tenants[3]!.id,
      title: 'Bedroom radiator stays cold',
      description: 'The rest of the flat heats up fine; this one radiator never warms.',
      status: 'submitted',
    },
    {
      id: IDS.maintenance(3),
      org_id: DEMO_ORG_ID,
      unit_id: units[6]!.id,
      tenant_id: tenants[6]!.id,
      title: 'Front door lock sticking',
      description: 'Key turns but the latch catches. A locksmith is booked for Thursday.',
      status: 'in_progress',
    },
    {
      id: IDS.maintenance(4),
      org_id: DEMO_ORG_ID,
      unit_id: units[9]!.id,
      tenant_id: tenants[9]!.id,
      title: 'Extractor fan replaced',
      description: 'Bathroom fan had stopped. New unit fitted and tested.',
      status: 'done',
    },
  ]

  return {
    anchor,
    periods,
    properties,
    units,
    tenants,
    leases,
    tariffs,
    readings,
    invoices,
    payments,
    maintenance,
  }
}
