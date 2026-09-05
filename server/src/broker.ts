/**
 * The one place this server talks to Claude.
 *
 * It holds no Anthropic key. All three model calls — parse, prices, refine —
 * go to the ai-broker on the mini, which owns the only key on the estate,
 * enforces this app's monthly budget, and writes an audit line per call.
 *
 * Metered rather than the Max subscription for now, and the reason is worth
 * keeping: all three calls demand a strict JSON schema, and parse also sends
 * photographs. The subscription path can do images, but it has no structured
 * output — it asks for a shape in prose and the broker verifies afterwards. A
 * mis-parsed grocery list is a worse outcome than a few cents, so the trade
 * stays this way until it clearly is not.
 */

const BROKER_URL = (process.env.BROKER_URL ?? 'http://172.18.0.1:8610').replace(/\/+$/, '')
const APP_ID = process.env.BROKER_APP_ID ?? 'mise'
const TIMEOUT_MS = Number(process.env.BROKER_TIMEOUT_MS ?? 120_000)

export interface BrokerImage {
  media_type: string
  data: string
}

export class BrokerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string = '',
  ) {
    super(message)
    this.name = 'BrokerError'
  }
}

/**
 * Ask for a JSON answer matching `schema`, and get it back parsed.
 *
 * The broker guarantees the shape or throws, so no caller here parses prose.
 * A model refusal arrives as status 422 with code `model_refused`, distinct
 * from a malformed answer, because the two need different messages.
 */
export async function askStructured<T>(opts: {
  prompt: string
  schema: unknown
  system?: string
  images?: BrokerImage[]
  maxTokens?: number
  model?: string
}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(`${BROKER_URL}/v1/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        app_id: APP_ID,
        prompt: opts.prompt,
        schema: opts.schema,
        max_tokens: opts.maxTokens ?? 8000,
        ...(opts.system ? { system: opts.system } : {}),
        ...(opts.images?.length ? { images: opts.images } : {}),
        ...(opts.model ? { model: opts.model } : {}),
        // Matches what this server always sent. It also selects the broker's
        // native json_schema path, which is what these strict schemas need.
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    })
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError'
    throw new BrokerError(
      aborted
        ? `the parser did not answer within ${TIMEOUT_MS / 1000}s`
        : `could not reach the parser: ${(err as Error).message}`,
      504,
    )
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    let detail = String(res.status)
    let code = ''
    try {
      const body = (await res.json()) as { error?: string; detail?: unknown }
      code = String(body.error ?? '')
      detail = String(body.detail ?? body.error ?? detail)
    } catch {
      /* a non-JSON error body still carries its status */
    }
    throw new BrokerError(detail, res.status, code)
  }

  const body = (await res.json()) as { data?: unknown }
  if (!body.data || typeof body.data !== 'object') {
    throw new BrokerError('no structured output returned', 502)
  }
  return body.data as T
}
