/**
 * AI provider interface.
 *
 * Claude is the only provider in the MVP (decision D25), but every AI-backed
 * task talks to THIS interface, never to the Anthropic SDK. Swapping vendors is
 * then a new file implementing `AiProvider` — not an edit to the code that
 * decides what to ask and what to do with the answer. This is deliberately the
 * same shape as lib/notifications/types.ts, for the same reason.
 *
 * Two rules of this layer are encoded in the types rather than written down:
 *
 * 1. `run()` RESOLVES to a labelled failure; it never rejects. AC9.5 promises
 *    that a fault in the AI layer can never block manual entry, and the cheapest
 *    way to keep that promise is to make it impossible for a caller to forget
 *    the catch. A caller that ignores `ok` does not compile.
 * 2. The answer's shape is described exactly once, as a zod schema on the
 *    request. The JSON Schema the API is given is generated FROM it
 *    (lib/ai/provider.ts) — never written by hand beside it.
 */

import type { ZodType } from 'zod'

/**
 * The tasks that exist. One member today: F9 is the only scope D25 opened.
 * Triage and portal Q&A are decided but not requested — no hook waits for them.
 */
export type AiTask = 'meter_ocr'

/** The image formats the Messages API accepts. */
export type AiImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

export interface AiImage {
  mediaType: AiImageMediaType
  /** Base64 payload only — no `data:` prefix and no newlines. */
  data: string
}

export interface AiRequest<T> {
  /** Which task this is. Carried for logging; it never changes the model. */
  task: AiTask
  system: string
  prompt: string
  /**
   * Photos the resident or the operator supplied. Untrusted input: anything
   * written on them is data, never instruction (D25).
   */
  images?: readonly AiImage[]
  /**
   * The shape the answer must have, and the only description of it. An answer
   * that does not fit is `invalid_output` — no suggestion, rather than a wrong
   * suggestion.
   */
  schema: ZodType<T>
  maxTokens?: number
}

/**
 * Why there is no answer. Four labels, because the caller has exactly one
 * decision to make — offer a suggestion or don't — and the label only has to
 * tell a person reading a log which of the four went wrong.
 *
 * - `no_provider`    ANTHROPIC_API_KEY is unset. Not an error: the feature is off.
 * - `network`        The call never came back with an answer (timeout, refused
 *                    connection, rate limit, rejected key, 5xx).
 * - `invalid_output` An answer came back that does not fit the schema.
 * - `refused`        The model declined the request.
 */
export type AiFailureReason = 'no_provider' | 'network' | 'invalid_output' | 'refused'

export type AiResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: AiFailureReason; message?: string }

export interface AiProvider {
  readonly name: string
  /** Resolves to a labelled failure instead of throwing. See rule 1 above. */
  run<T>(request: AiRequest<T>): Promise<AiResult<T>>
}
