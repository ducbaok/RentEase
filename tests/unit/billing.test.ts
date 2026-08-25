import { describe, expect, it } from 'vitest'
import {
  billableConsumption,
  buildInvoiceDraft,
  consumptionOf,
  dueDateFor,
  leaseCoversPeriod,
  pricingDateFor,
  selectTariffFor,
  type TariffSnapshot,
} from '@/lib/domain/billing'
import { breakdownTotalCents, isMeteredLine, parseBreakdown } from '@/lib/domain/breakdown'

/**
 * The arithmetic that turns a month into money.
 *
 * The worked example throughout is the one in docs/sot/30-data-model.md and in
 * the seed: unit 101, July 2026, 1420 → 2047 kWh at $0.14 and 3100 → 3450 gal
 * at $0.012, $1,200 rent and a $25 fee. If any test here disagrees with the
 * seeded invoice a0…050, one of the two is wrong.
 */

const TARIFF: TariffSnapshot = {
  electricRatePerKwh: 0.14,
  waterRatePerUnit: 0.012,
  serviceFeeCents: 2500,
  effectiveFrom: '2026-01-01',
}

describe('pricing date', () => {
  it('prices a period at its last day, so a mid-month rate change applies that month', () => {
    expect(pricingDateFor('2026-08')).toBe('2026-08-31')
    expect(pricingDateFor('2026-02')).toBe('2026-02-28')
  })
})

describe('selectTariffFor', () => {
  const january: TariffSnapshot = { ...TARIFF, effectiveFrom: '2026-01-01' }
  const midAugust: TariffSnapshot = {
    electricRatePerKwh: 0.19,
    waterRatePerUnit: 0.02,
    serviceFeeCents: 4000,
    effectiveFrom: '2026-08-15',
  }
  const september: TariffSnapshot = { ...midAugust, effectiveFrom: '2026-09-01' }

  it('picks the newest card already in effect', () => {
    expect(selectTariffFor([january, midAugust, september], '2026-08')).toBe(midAugust)
  })

  it('ignores cards that start after the period ends', () => {
    expect(selectTariffFor([january, september], '2026-08')).toBe(january)
  })

  it('does not depend on the order rows arrive in', () => {
    expect(selectTariffFor([september, midAugust, january], '2026-08')).toBe(midAugust)
  })

  it('returns null when no rates were ever set that early', () => {
    expect(selectTariffFor([september], '2026-08')).toBeNull()
    expect(selectTariffFor([], '2026-08')).toBeNull()
  })

  it('applies a card that starts on the very last day of the period', () => {
    const lastDay: TariffSnapshot = { ...midAugust, effectiveFrom: '2026-08-31' }
    expect(selectTariffFor([january, lastDay], '2026-08')).toBe(lastDay)
  })

  // The batch plan calls this one out by name: a service fee that changes
  // part-way through a month must not produce two different answers depending
  // on which code path asked.
  it('a service fee raised mid-period is the fee billed for that period', () => {
    const chosen = selectTariffFor([january, midAugust], '2026-08')
    expect(chosen?.serviceFeeCents).toBe(4000)
    expect(selectTariffFor([january, midAugust], '2026-07')?.serviceFeeCents).toBe(2500)
  })
})

describe('dueDateFor', () => {
  it('falls on the billing day of the month after the period', () => {
    expect(dueDateFor('2026-07', 5)).toBe('2026-08-05')
    expect(dueDateFor('2026-12', 1)).toBe('2027-01-01')
  })

  it('pads single-digit days', () => {
    expect(dueDateFor('2026-08', 3)).toBe('2026-09-03')
  })

  it('refuses a billing day that does not exist in every month', () => {
    expect(() => dueDateFor('2026-01', 31)).toThrow(/between 1 and 28/)
    expect(() => dueDateFor('2026-01', 0)).toThrow(/between 1 and 28/)
    expect(() => dueDateFor('2026-01', 2.5)).toThrow(/between 1 and 28/)
  })

  it('refuses a malformed period before it can reach a query', () => {
    expect(() => dueDateFor('2026-13', 5)).toThrow(/Invalid billing period/)
  })
})

describe('consumption', () => {
  it('is the difference between the two readings', () => {
    expect(consumptionOf({ prev: 1420, curr: 2047 })).toBe(627)
  })

  it('is zero when the readings are identical — an empty unit still gets a bill', () => {
    expect(consumptionOf({ prev: 500, curr: 500 })).toBe(0)
    expect(billableConsumption({ prev: 500, curr: 500 })).toBe(0)
  })

  it('reports a decrease honestly but never bills for it', () => {
    expect(consumptionOf({ prev: 9990, curr: 12 })).toBe(-9978)
    expect(billableConsumption({ prev: 9990, curr: 12 })).toBe(0)
  })

  it('does not leak binary floating point into a reading', () => {
    expect(consumptionOf({ prev: 2047.1, curr: 2610 })).toBe(562.9)
  })
})

describe('buildInvoiceDraft', () => {
  const draft = buildInvoiceDraft({
    period: '2026-07',
    rentCents: 120000,
    billingDay: 5,
    tariff: TARIFF,
    electric: { prev: 1420, curr: 2047 },
    water: { prev: 3100, curr: 3450 },
  })

  it('reproduces the seeded invoice to the cent', () => {
    expect(draft.rentCents).toBe(120000)
    expect(draft.electricCents).toBe(8778)
    expect(draft.waterCents).toBe(420)
    expect(draft.serviceCents).toBe(2500)
    expect(draft.totalCents).toBe(131698)
    expect(draft.dueDate).toBe('2026-08-05')
  })

  it('produces a breakdown that adds up to its own total', () => {
    expect(breakdownTotalCents(draft.breakdown)).toBe(draft.totalCents)
  })

  it('produces a breakdown the shared validator accepts', () => {
    expect(parseBreakdown(draft.breakdown)).toHaveLength(draft.breakdown.length)
  })

  it('shows the working on every metered line', () => {
    const electric = draft.breakdown.find((line) => line.kind === 'electric')
    expect(electric && isMeteredLine(electric)).toBe(true)
    expect(electric).toMatchObject({
      prev: 1420,
      curr: 2047,
      consumption: 627,
      unit: 'kWh',
      rate: 0.14,
      amount_cents: 8778,
    })
  })

  it('rounds each line once, so cents do not drift', () => {
    // 627 × 0.1425 = 89.3475 → $89.35, not $89.34 and not a fraction of a cent.
    const rounded = buildInvoiceDraft({
      period: '2026-07',
      rentCents: 0,
      billingDay: 1,
      tariff: { ...TARIFF, electricRatePerKwh: 0.1425, serviceFeeCents: 0 },
      electric: { prev: 1420, curr: 2047 },
    })
    expect(rounded.electricCents).toBe(8935)
    expect(rounded.totalCents).toBe(8935)
  })

  it('bills nothing for a meter that rolled over, and says so in the breakdown', () => {
    const rollover = buildInvoiceDraft({
      period: '2026-08',
      rentCents: 100000,
      billingDay: 5,
      tariff: TARIFF,
      electric: { prev: 9990, curr: 12 },
    })
    expect(rollover.electricCents).toBe(0)
    expect(rollover.totalCents).toBe(102500)
    expect(rollover.breakdown.find((line) => line.kind === 'electric')).toMatchObject({
      prev: 9990,
      curr: 12,
      consumption: 0,
      amount_cents: 0,
    })
  })

  it('omits a metered line entirely when no reading was entered', () => {
    const rentOnly = buildInvoiceDraft({
      period: '2026-08',
      rentCents: 98000,
      billingDay: 5,
      tariff: TARIFF,
    })
    expect(rentOnly.breakdown.map((line) => line.kind)).toEqual(['rent', 'service'])
    expect(rentOnly.totalCents).toBe(100500)
  })

  it('omits a zero service fee rather than printing a $0.00 line', () => {
    const noFee = buildInvoiceDraft({
      period: '2026-08',
      rentCents: 50000,
      billingDay: 5,
      tariff: { ...TARIFF, serviceFeeCents: 0 },
    })
    expect(noFee.breakdown.map((line) => line.kind)).toEqual(['rent'])
  })

  it('carries an ad-hoc charge with the label it was given', () => {
    const withOther = buildInvoiceDraft({
      period: '2026-08',
      rentCents: 50000,
      billingDay: 5,
      tariff: { ...TARIFF, serviceFeeCents: 0 },
      otherCents: 4500,
      otherLabel: 'Replacement key',
    })
    expect(withOther.totalCents).toBe(54500)
    expect(withOther.breakdown.at(-1)).toEqual({
      kind: 'other',
      label: 'Replacement key',
      amount_cents: 4500,
    })
  })

  it('prices a whole month at a rate that took effect inside it', () => {
    const raised = buildInvoiceDraft({
      period: '2026-08',
      rentCents: 0,
      billingDay: 5,
      tariff: { ...TARIFF, electricRatePerKwh: 0.19, serviceFeeCents: 4000, effectiveFrom: '2026-08-15' },
      electric: { prev: 2047, curr: 2610 },
    })
    expect(raised.electricCents).toBe(10697) // 563 × 0.19
    expect(raised.serviceCents).toBe(4000)
  })
})

describe('leaseCoversPeriod', () => {
  const lease = { start_date: '2026-03-01', end_date: '2026-09-30', status: 'active' }

  it('bills a month the lease was live for', () => {
    expect(leaseCoversPeriod(lease, '2026-08')).toBe(true)
  })

  it('does not bill a month before the lease started', () => {
    expect(leaseCoversPeriod(lease, '2026-02')).toBe(false)
  })

  it('does not bill a month after the lease ended', () => {
    expect(leaseCoversPeriod(lease, '2026-10')).toBe(false)
  })

  it('bills the month a lease starts in, even if it starts on the last day', () => {
    expect(leaseCoversPeriod({ ...lease, start_date: '2026-03-31' }, '2026-03')).toBe(true)
  })

  it('bills the month a lease ends in, even if it ends on the first day', () => {
    expect(leaseCoversPeriod({ ...lease, end_date: '2026-09-01' }, '2026-09')).toBe(true)
  })

  it('treats an open-ended lease as running forever', () => {
    expect(leaseCoversPeriod({ ...lease, end_date: null }, '2030-01')).toBe(true)
  })

  it('never bills a lease that has been ended', () => {
    expect(leaseCoversPeriod({ ...lease, status: 'ended' }, '2026-08')).toBe(false)
  })
})
