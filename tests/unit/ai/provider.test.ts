import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * lib/env.ts validates the Supabase variables at module load and lib/ai/provider.ts
 * imports it for optionalServerEnv, so the module graph does not load without them.
 * Neither Supabase nor these values are under test here; vi.hoisted runs before the
 * imports below, which is the only reason this sits above them.
 */
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon-key-not-used-by-these-tests'
})
import { z } from 'zod'
import {
  anthropicProvider,
  getAiProvider,
  isAiConfigured,
  outputFormatFor,
  setAiProvider,
  stubProvider,
} from '@/lib/ai/provider'
import { meterReadingSchema } from '@/lib/ai/schemas'
import type { AiProvider } from '@/lib/ai/types'

/**
 * Nothing here reaches the network. `anthropicProvider()` only constructs an
 * SDK client; `run()` is never called on it, and the key below is not a key.
 * A developer with a real ANTHROPIC_API_KEY in .env.local must get the same
 * result as CI, so every test sets the variable itself.
 */
const FAKE_KEY = 'sk-ant-not-a-real-key'

describe('getAiProvider', () => {
  const original = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    setAiProvider(null)
  })

  afterEach(() => {
    setAiProvider(null)
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = original
  })

  it('uses Anthropic when a key is configured', () => {
    process.env.ANTHROPIC_API_KEY = FAKE_KEY
    expect(getAiProvider().name).toBe('anthropic')
  })

  it('falls back to the stub when no key is configured', () => {
    delete process.env.ANTHROPIC_API_KEY
    expect(getAiProvider()).toBe(stubProvider)
  })

  it('treats an empty key as no key — the feature is off, not half on', () => {
    process.env.ANTHROPIC_API_KEY = ''
    expect(getAiProvider()).toBe(stubProvider)
  })

  it('caches the choice, and setAiProvider replaces it for a test', () => {
    process.env.ANTHROPIC_API_KEY = FAKE_KEY
    const first = getAiProvider()
    expect(getAiProvider()).toBe(first)

    const fake: AiProvider = { name: 'fake', async run() { return { ok: false, reason: 'network' } } }
    setAiProvider(fake)
    expect(getAiProvider()).toBe(fake)

    setAiProvider(null)
    expect(getAiProvider()).not.toBe(fake)
  })
})

/**
 * The branch the end-to-end suite cannot reach, because a run that proves the
 * camera works is by definition a run with a provider installed.
 *
 * The meter screen asks this before drawing a camera button per row, so getting
 * it wrong is visible in one direction (buttons that can only ever say "switched
 * off") and invisible in the other (a configured deployment where the feature
 * silently never appears).
 */
describe('isAiConfigured', () => {
  const original = process.env.ANTHROPIC_API_KEY

  beforeEach(() => setAiProvider(null))

  afterEach(() => {
    setAiProvider(null)
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = original
  })

  it('is false with no key — there is nothing to offer, so nothing is offered', () => {
    delete process.env.ANTHROPIC_API_KEY
    expect(isAiConfigured()).toBe(false)
  })

  it('is true with a key', () => {
    process.env.ANTHROPIC_API_KEY = FAKE_KEY
    expect(isAiConfigured()).toBe(true)
  })

  it('follows the PROVIDER, not the variable, so an installed fake counts', () => {
    // What makes the feature testable end to end: tests/e2e/meter-photo.spec.ts
    // runs against a server with a scripted provider and no key at all, and the
    // camera has to be there.
    delete process.env.ANTHROPIC_API_KEY
    setAiProvider({ name: 'scripted', async run() { return { ok: false, reason: 'network' } } })
    expect(isAiConfigured()).toBe(true)
  })
})

describe('stubProvider', () => {
  it('answers no_provider instead of throwing (AC9.5)', async () => {
    const result = await stubProvider.run({
      task: 'meter_ocr',
      system: 'unused',
      prompt: 'unused',
      schema: meterReadingSchema,
    })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('no_provider')
  })
})

describe('anthropicProvider', () => {
  it('is named for its vendor and builds without touching the network', () => {
    expect(anthropicProvider(FAKE_KEY).name).toBe('anthropic')
  })
})

describe('outputFormatFor', () => {
  /*
   * These assertions read the zod schema at run time rather than restating its
   * fields, so they fail the moment the JSON Schema stops being generated from
   * it — which is the only failure mode worth guarding here.
   */
  it('generates the JSON Schema from the zod schema, field for field', () => {
    const format = outputFormatFor(meterReadingSchema)
    const jsonSchema = format.schema as {
      properties: Record<string, unknown>
      required: string[]
      additionalProperties?: boolean
    }

    const zodKeys = Object.keys(meterReadingSchema.shape).sort()
    expect(format.type).toBe('json_schema')
    expect(Object.keys(jsonSchema.properties).sort()).toEqual(zodKeys)
    expect([...jsonSchema.required].sort()).toEqual(zodKeys)
    expect(jsonSchema.additionalProperties).toBe(false)
  })

  /*
   * The API's structured-output subset accepts neither `enum` nor `minimum`, so
   * the SDK folds them into the field description: they reach the model as a
   * hint, not as a guarantee. That is precisely why the provider re-validates
   * the answer with the same zod schema before returning it.
   */
  it('carries the enum values zod declares, not a hand-copied list', () => {
    const jsonSchema = outputFormatFor(meterReadingSchema).schema as {
      properties: { confidence: { description?: string } }
    }

    for (const option of meterReadingSchema.shape.confidence.options) {
      expect(jsonSchema.properties.confidence.description).toContain(option)
    }
  })

  it('leaves no callable behind in the request body', () => {
    const format = outputFormatFor(z.strictObject({ answer: z.string() }))
    expect(Object.values(format)).not.toContainEqual(expect.any(Function))
  })
})
