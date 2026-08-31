import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { ZodType } from 'zod'
import { optionalServerEnv } from '@/lib/env'
import type { AiImage, AiProvider, AiRequest, AiResult } from './types'

/**
 * The model D25 chose: one model for every task, because all of them need to
 * read an image and return structured output, so splitting vendors per task
 * would buy nothing and cost a second surface to maintain.
 */
export const AI_MODEL = 'claude-opus-5'

/** Enough for a small JSON object. Callers that need more say so. */
const DEFAULT_MAX_TOKENS = 1024

/**
 * The provider that is never a provider. Chosen automatically when
 * ANTHROPIC_API_KEY is unset, exactly as `consoleProvider` is chosen when
 * RESEND_API_KEY is (D25), so the whole test suite and any developer without a
 * key run offline.
 *
 * `no_provider` is an answer, not an error: the screens that ask for a
 * suggestion simply do not get one, and manual entry is untouched (AC9.4).
 */
export const stubProvider: AiProvider = {
  name: 'stub',
  async run() {
    return { ok: false, reason: 'no_provider' }
  },
}

/**
 * The JSON Schema the API is given, generated FROM the request's zod schema.
 *
 * The API speaks JSON Schema and zod is a different thing, so something has to
 * translate. It has to be a translation and not a second hand-written copy —
 * see the header of lib/ai/schemas.ts.
 */
export function outputFormatFor<T>(schema: ZodType<T>): Anthropic.JSONOutputFormat {
  const format = zodOutputFormat(schema)
  // Drop the helper's `parse` closure: this object is a request body, and the
  // parsing below is ours so that a bad answer is a labelled result, not a throw.
  return { type: format.type, schema: format.schema }
}

function toImageBlock(image: AiImage): Anthropic.ImageBlockParam {
  return {
    type: 'image',
    source: { type: 'base64', media_type: image.mediaType, data: image.data },
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function anthropicProvider(apiKey: string): AiProvider {
  const client = new Anthropic({ apiKey })

  return {
    name: 'anthropic',
    async run<T>(request: AiRequest<T>): Promise<AiResult<T>> {
      let message: Anthropic.Message
      try {
        message = await client.messages.create({
          model: AI_MODEL,
          max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          system: request.system,
          output_config: { format: outputFormatFor(request.schema) },
          messages: [
            {
              role: 'user',
              content: [
                ...(request.images ?? []).map(toImageBlock),
                { type: 'text', text: request.prompt },
              ],
            },
          ],
        })
      } catch (error) {
        // Every way of failing to get an answer out of the API lands here: a
        // refused connection, a timeout, a rate limit, a rejected key, a 5xx.
        // They are one label because the caller has one decision, and it is the
        // same decision for all of them.
        return { ok: false, reason: 'network', message: describe(error) }
      }

      if (message.stop_reason === 'refusal') {
        return {
          ok: false,
          reason: 'refused',
          message: message.stop_details?.explanation ?? 'the model declined the request',
        }
      }

      const text = message.content.find((block) => block.type === 'text')?.text
      if (!text) {
        return { ok: false, reason: 'invalid_output', message: 'no text block in the response' }
      }

      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        // Truncation (stop_reason 'max_tokens') arrives here as half an object.
        return { ok: false, reason: 'invalid_output', message: 'the response was not JSON' }
      }

      // The generated JSON Schema is a shape, not a guard: the API's subset of
      // JSON Schema drops `enum`, `minimum` and friends into a description, so
      // bounds reach the model as a hint. zod is what actually decides, and it
      // decides here — on every answer, including one talked into a number the
      // schema forbids.
      const parsed = request.schema.safeParse(json)
      if (!parsed.success) {
        return { ok: false, reason: 'invalid_output', message: parsed.error.message }
      }

      return { ok: true, value: parsed.data }
    },
  }
}

let cached: AiProvider | null = null

/** The provider for this environment. Anthropic when configured, stub otherwise. */
export function getAiProvider(): AiProvider {
  if (cached) return cached
  const apiKey = optionalServerEnv('ANTHROPIC_API_KEY')
  cached = apiKey ? anthropicProvider(apiKey) : stubProvider
  return cached
}

/** Test seam: lets a test install a fake provider. Pass null to reset. */
export function setAiProvider(provider: AiProvider | null): void {
  cached = provider
}
