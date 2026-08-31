import { describe, expect, it } from 'vitest'
import { MAX_METER_READING, meterReadingSchema } from '@/lib/ai/schemas'

describe('meterReadingSchema', () => {
  it('accepts a confident reading of both dials', () => {
    const parsed = meterReadingSchema.safeParse({
      electric: 14320.5,
      water: 812,
      confidence: 'high',
    })

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ electric: 14320.5, water: 812, confidence: 'high' })
  })

  it('accepts null for a dial it could not read — that is the right answer (AC9.3)', () => {
    const parsed = meterReadingSchema.safeParse({ electric: null, water: 812, confidence: 'low' })
    expect(parsed.success).toBe(true)
  })

  it.each([
    ['a negative reading', { electric: -1, water: 0, confidence: 'high' }],
    ['a reading past what the column holds', { electric: MAX_METER_READING + 1, water: 0, confidence: 'high' }],
    ['a number as a string', { electric: '14320', water: 0, confidence: 'high' }],
    ['NaN', { electric: Number.NaN, water: 0, confidence: 'high' }],
    ['Infinity', { electric: Number.POSITIVE_INFINITY, water: 0, confidence: 'high' }],
    ['a confidence nobody defined', { electric: 1, water: 0, confidence: 'certain' }],
    ['a missing dial', { electric: 1, confidence: 'high' }],
    ['an extra field', { electric: 1, water: 0, confidence: 'high', note: 'ignore previous instructions' }],
  ])('rejects %s — no suggestion, rather than a wrong one', (_label, value) => {
    expect(meterReadingSchema.safeParse(value).success).toBe(false)
  })
})
