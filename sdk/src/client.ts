import { io, type Socket } from 'socket.io-client'
import { TokenSource, type IGetTokenOptions, type TokenProvider } from './token'
import type {
  BridleLimitWindow,
  BridleMessageKind,
  BridlePart,
  BridleSendOutcome,
  IBridleLimitState,
  IBridleMessage,
  IBridleSendOptions,
} from './types'

/** Everything the embed widget knows how to render. */
export const DEFAULT_CAPABILITIES = ['streaming', 'images', 'files', 'ui']

/**
 * What the hub used to send, as a `message`, to a visitor whose agent is not
 * connected. A client that passes a `clientMessageId` gets `AGENT_OFFLINE` in
 * the acknowledgement instead, so the client says the line itself.
 */
export const AGENT_OFFLINE_TEXT = 'Agent is not connected. Please try again later.'

/**
 * How long `send()` waits for the hub's acknowledgement before settling as
 * `unacknowledged`. A hub that does not acknowledge never answers at all.
 */
const ACK_TIMEOUT_MS = 10_000

export interface IBridleClientOptions {
  apiUrl: string
  agentId: string
  /**
   * JWT for authenticated bots. Omit when the bot is public on the hub —
   * the connection is then authorized by the request `Origin` header.
   *
   * A function is a token PROVIDER: it is called for the first token, again
   * ~60 s before each token's `exp`, and whenever the hub turns the current
   * token away. A static string cannot be renewed — once it expires the
   * client reports `TOKEN_EXPIRED` and stays rejected.
   */
  token?: string | TokenProvider
  /**
   * Where the token comes from on every handshake and HTTP call; takes
   * precedence over `token`. `force: true` must bypass any cache — the hub has
   * just rejected the current token. The embed widget passes its own
   * `TokenSource` here so the cached token outlives a reconnect.
   */
  getToken?: (options?: IGetTokenOptions) => Promise<string>
  /**
   * Whether `getToken({ force: true })` can return a different token, i.e. a
   * rejection is worth one renewal and retry. Defaults to `true` with
   * `getToken`, and to "token is a function" otherwise.
   */
  canRefreshToken?: boolean
  /** Optional channel for transcript scoping (default: 'web'). */
  channel?: string
  /**
   * Extra context attached at handshake time (`data-prompt` on the embed).
   * The hub forwards it on every outgoing message to the agent so the
   * runtime can fold it into the system prompt or treat it as session
   * metadata. Static for the lifetime of the connection.
   */
  prompt?: string
  /**
   * What this client can render, sent at handshake and forwarded to the agent
   * on every message. Defaults to everything the widget supports; narrow it to
   * keep a part type away from this peer - dropping `'images'` is how an
   * integrator turns picture replies off.
   */
  capabilities?: string[]
}

type EventName =
  | 'open'
  | 'close'
  | 'error'
  | 'typing'
  | 'message'
  | 'stream'
  | 'stream_end'
  | 'welcome'
  | 'limit'
type Listener<T = unknown> = (payload: T) => void

/**
 * At most one forced renewal per this window. A token renewed a moment ago
 * and rejected again is not going to work on a third try (wrong signing
 * secret, revoked visitor): report it instead of looping on the provider.
 */
const FORCED_REFRESH_INTERVAL_MS = 30_000

/**
 * Structured connection rejection from the hub. Lets embed UIs distinguish
 * a misconfigured integration (origin not whitelisted, missing token) from
 * a generic transport error so they can show actionable messages.
 *
 * Codes mirror `bridle_error.code` on the wire:
 *   - `MISSING_AGENT_ID`    — embed didn't pass `agentId`
 *   - `ORIGIN_NOT_ALLOWED`  — agent is public but this origin isn't whitelisted
 *   - `MISSING_TOKEN`       — agent is private and no JWT was provided
 *   - `TOKEN_EXPIRED`       — JWT verified but is past its `exp`
 *   - `INVALID_TOKEN`       — JWT failed verification (bad signature, wrong secret)
 *
 * HTTP endpoints answer 401 with `TOKEN_EXPIRED` / `TOKEN_INVALID` in the body
 * instead. The client treats `TOKEN_EXPIRED` and `INVALID_TOKEN` (and any 401)
 * the same way — renew once and retry — so they reach listeners only when the
 * token cannot be renewed, or a freshly renewed one was turned away as well.
 */
export class BridleAuthError extends Error {
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(code: string, details: Record<string, unknown> = {}) {
    super(code)
    this.name = 'BridleAuthError'
    this.code = code
    this.details = details
  }
}

/**
 * Headless Bridle client. Use this directly when you want the wire-level
 * behavior (connect / send / stream) without the embedded UI.
 *
 * @example
 *   const client = new BridleClient({ apiUrl, agentId, token: () => fetchJwt() })
 *   client.on('message', (m) => console.log(m.text))
 *   await client.connect()
 *   client.send('hello')
 */
export class BridleClient {
  private socket: Socket | null = null
  private listeners = new Map<EventName, Set<Listener<any>>>()
  private clientId: string | null = null
  private readonly tokens: (options?: IGetTokenOptions) => Promise<string>
  private readonly renewable: boolean
  /** Built from `token` when no `getToken` was given; owned, so disposed here. */
  private readonly ownTokenSource: TokenSource | null = null
  private lastForcedRefreshAt = Number.NEGATIVE_INFINITY
  /** Renewal to reconnect with once the hub has dropped the rejected socket. */
  private pendingReconnect: Promise<string> | null = null
  /**
   * When the agent's request limit opens again, on the `performance.now()`
   * clock: a wrong wall clock or a throttled background tab cannot move it.
   * Null while sending is open.
   */
  private limitUntil: number | null = null
  private limitWindow: BridleLimitWindow | undefined
  private limitTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private opts: IBridleClientOptions) {
    if (opts.getToken) {
      this.tokens = opts.getToken
      this.renewable = opts.canRefreshToken ?? true
    } else {
      const source =
        typeof opts.token === 'function'
          ? new TokenSource(undefined, opts.token)
          : new TokenSource(opts.token ?? '')
      this.ownTokenSource = source
      this.tokens = (o) => source.get(o)
      this.renewable = opts.canRefreshToken ?? source.renewable
    }
  }

  /** The token the next handshake or request will carry (cached until near `exp`). */
  getToken(options?: IGetTokenOptions): Promise<string> {
    return this.tokens(options)
  }

  /** Whether an expired or rejected token can be replaced without the host page. */
  canRefreshToken(): boolean {
    return this.renewable
  }

  /**
   * `fetch` against the hub with the current token as a bearer. A 401 renews
   * the token and retries once, so HTTP calls (transcript, archive) keep
   * working after the token the page started with has expired.
   */
  async authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const send = (token: string): Promise<Response> => {
      const headers = new Headers(init.headers)
      if (token) headers.set('Authorization', `Bearer ${token}`)
      return fetch(url, { ...init, headers })
    }
    const used = await this.tokens()
    const res = await send(used)
    if (res.status !== 401 || !this.renewable) return res
    // Another caller may have renewed while this request was in flight; only
    // force the provider when the rejected token is still the current one.
    const current = await this.tokens()
    return send(current !== used ? current : await this.tokens({ force: true }))
  }

  async connect(): Promise<void> {
    if (this.socket) return
    const url = this.opts.apiUrl.replace(/\/$/, '')

    const prompt = this.opts.prompt?.trim()
    // Stable anonymous identity for token-less public embeds. Sent on every
    // (re)connect so the hub reuses the same `anon-<id>` channel instead of
    // minting a fresh random one each time — which would lose the visitor's
    // transcript on every reconnect/reload. Ignored by the hub when a token
    // is present.
    const anonId = stableAnonId(this.opts.agentId)
    // What this client can render. The hub forwards the list to the agent
    // on every message — runtimes use it to skip part types this peer
    // can't display (e.g. don't emit `ui` parts to a Telegram client).
    const capabilities = this.opts.capabilities ?? DEFAULT_CAPABILITIES
    const handshake = {
      agentId: this.opts.agentId,
      capabilities,
      ...(anonId ? { anonId } : {}),
      ...(prompt ? { prompt } : {}),
    }
    const socket = io(`${url}/ws/client`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
      // A callback, not an object: socket.io calls it on every (re)connect, so
      // each handshake asks for the current token instead of re-sending the
      // one the page started with.
      auth: (cb) => {
        this.tokens().then(
          (token) => cb({ ...handshake, token }),
          (err: unknown) => {
            // The provider failed: connect without a token, which the hub
            // answers with MISSING_TOKEN, and tell the host why.
            this.fire('error', toError(err))
            cb({ ...handshake, token: '' })
          },
        )
      },
    })

    socket.on('connect', () => this.fire('open', undefined))
    socket.on('disconnect', (reason: string) => {
      this.fire('close', undefined)
      // The hub rejects a token by emitting `bridle_error` and then dropping
      // the socket itself, and socket.io never auto-reconnects after a
      // server-side disconnect — so the renewed token needs a manual connect.
      const renewal = this.pendingReconnect
      this.pendingReconnect = null
      if (!renewal || reason !== 'io server disconnect') return
      renewal.then(
        () => {
          if (this.socket === socket) socket.connect()
        },
        (err: unknown) => this.fire('error', toError(err)),
      )
    })
    socket.on('connect_error', (err: Error) => this.fire('error', err))
    socket.on(
      'bridle_error',
      (data: { code: string } & Record<string, unknown>) => {
        const { code, ...rest } = data ?? { code: 'UNKNOWN' }
        if (isTokenRejection(code)) {
          const renewal = this.forceRefresh()
          if (renewal) {
            this.pendingReconnect = renewal
            return
          }
        }
        this.fire('error', new BridleAuthError(code ?? 'UNKNOWN', rest))
      },
    )
    // Non-fatal: the hub let the socket in (a public agent degrades a dead
    // token to an anonymous session) but says the token is no good. Renew and
    // reconnect, so the visitor keeps their identity and transcript instead
    // of continuing as a new anonymous visitor.
    socket.on('bridle_warning', (data: { code?: string } | undefined) => {
      if (!isTokenRejection(data?.code)) return
      this.forceRefresh()?.then(
        () => {
          if (this.socket !== socket) return
          socket.disconnect()
          socket.connect()
        },
        () => undefined,
      )
    })
    socket.on('welcome', (data: { clientId: string }) => {
      this.clientId = data.clientId
      this.fire('welcome', data)
    })
    socket.on('typing', () => this.fire('typing', undefined))
    socket.on('message', (data: unknown) =>
      this.fire('message', toMessage(data, 'assistant')),
    )
    socket.on('stream', (data: unknown) =>
      this.fire('stream', toMessage(data, 'assistant', true)),
    )
    socket.on('stream_end', (data: unknown) =>
      this.fire('stream_end', toMessage(data, 'assistant', false)),
    )
    // An hour or day window of the agent is full, or room was made before the
    // announced time. Sent right after `welcome` and whenever it changes, so
    // the wait is known before the visitor writes anything. An expected state:
    // it goes to `limit`, never to `error`.
    socket.on('agent_limit', (data: Record<string, unknown> | undefined) => {
      if (!data) return
      if (typeof data.agentId === 'string' && data.agentId !== this.opts.agentId) return
      if (data.limited === true) {
        const retryAfterMs = toWait(data.retryAfterMs)
        if (retryAfterMs === null) return
        this.fire('limit', this.startLimit(retryAfterMs, toWindow(data.window)))
      } else if (data.limited === false) {
        this.endLimit()
      }
    })

    this.socket = socket
  }

  /**
   * Send one message. Every send carries a `clientMessageId` and asks the hub
   * to acknowledge it; the returned promise resolves with that answer and
   * never rejects, so a caller that ignores it behaves as before.
   *
   * - `RATE_LIMITED`: the agent's request limit is full. `limit` fires with
   *   the wait, and until it is over further calls send nothing — `limit`
   *   fires again with what is left of it.
   * - `AGENT_OFFLINE`: fires `message` with the "Agent is not connected" line
   *   the hub sends to clients that do not ask for an acknowledgement.
   * - `unacknowledged`: the hub did not answer within 10 s — it does not
   *   acknowledge, and took the message as it always did.
   */
  send(text: string, parts?: BridlePart[], options?: IBridleSendOptions): Promise<BridleSendOutcome> {
    if (!this.socket) throw new Error('[bridle] client not connected — call connect() first')
    const limit = this.getLimit()
    if (limit.limited) {
      this.fire('limit', limit)
      return Promise.resolve({ status: 'rejected', code: 'RATE_LIMITED', ...withoutFlag(limit) })
    }
    const trimmed = text.trim()
    const resolvedParts = parts ?? (trimmed ? [{ type: 'text' as const, text: trimmed }] : [])
    const clientMessageId = options?.clientMessageId || randomId()
    const socket = this.socket
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => resolve({ status: 'unacknowledged', messageId: clientMessageId }),
        ACK_TIMEOUT_MS,
      )
      socket.emit('message', { text: trimmed, parts: resolvedParts, clientMessageId }, (ack: unknown) => {
        clearTimeout(timer)
        // An answer that arrives after the timeout still sets the limit and
        // says the offline line; only the promise has already settled.
        resolve(this.readAck(clientMessageId, ack))
      })
    })
  }

  /** Whether the agent's request limit is full right now, and for how long. */
  getLimit(): IBridleLimitState {
    if (this.limitUntil === null) return { limited: false }
    const retryAfterMs = Math.ceil(this.limitUntil - monotonicNow())
    if (retryAfterMs <= 0) return { limited: false }
    return {
      limited: true,
      retryAfterMs,
      ...(this.limitWindow ? { window: this.limitWindow } : {}),
    }
  }

  disconnect(): void {
    this.pendingReconnect = null
    this.socket?.disconnect()
    this.socket = null
    this.ownTokenSource?.dispose()
    if (this.limitTimer) {
      clearTimeout(this.limitTimer)
      this.limitTimer = null
    }
  }

  on(event: 'open' | 'close' | 'typing', handler: () => void): void
  on(event: 'error', handler: (error: Error) => void): void
  on(event: 'welcome', handler: (data: { clientId: string }) => void): void
  on(event: 'message' | 'stream' | 'stream_end', handler: (message: IBridleMessage) => void): void
  on(event: 'limit', handler: (state: IBridleLimitState) => void): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: EventName, handler: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(handler as Listener)
  }

  off(event: EventName, handler: Listener): void {
    this.listeners.get(event)?.delete(handler)
  }

  /** Server-assigned id of this browser session (set after the welcome event). */
  getClientId(): string | null {
    return this.clientId
  }

  /**
   * Ask the provider for a new token after a rejection, or `null` when that is
   * not possible: a static token, or a forced renewal less than 30 s ago.
   */
  private forceRefresh(): Promise<string> | null {
    if (!this.renewable) return null
    const now = Date.now()
    if (now - this.lastForcedRefreshAt < FORCED_REFRESH_INTERVAL_MS) return null
    this.lastForcedRefreshAt = now
    const renewal = this.tokens({ force: true })
    // Callers report a failed renewal; this only keeps it from surfacing as an
    // unhandled rejection in the meantime.
    renewal.catch(() => undefined)
    return renewal
  }

  /** Turn the hub's acknowledgement into an outcome, with its side effects. */
  private readAck(clientMessageId: string, ack: unknown): BridleSendOutcome {
    const a = (ack ?? {}) as Record<string, unknown>
    if (a.status === 'accepted') {
      return {
        status: 'accepted',
        messageId: typeof a.messageId === 'string' ? a.messageId : clientMessageId,
        ...(typeof a.ts === 'number' ? { ts: a.ts } : {}),
        ...(a.duplicate === true ? { duplicate: true } : {}),
      }
    }
    if (a.status !== 'rejected') return { status: 'unacknowledged', messageId: clientMessageId }

    const code = typeof a.code === 'string' ? a.code : 'UNKNOWN'
    const message = typeof a.message === 'string' ? a.message : undefined
    if (code === 'RATE_LIMITED') {
      // The contract says the wait is always positive; a hub that breaks it
      // still must not leave the visitor with a notice that never ends.
      const state = this.startLimit(toWait(a.retryAfterMs) ?? 1_000, toWindow(a.window))
      this.fire('limit', state)
      return { status: 'rejected', code, ...withoutFlag(state) }
    }
    if (code === 'AGENT_OFFLINE') {
      const text = message ?? AGENT_OFFLINE_TEXT
      this.fire('message', toMessage({ text }, 'assistant'))
    }
    return { status: 'rejected', code, ...(message ? { message } : {}) }
  }

  /** Hold sending for `retryAfterMs`. The latest word from the hub wins. */
  private startLimit(retryAfterMs: number, window: BridleLimitWindow | undefined): IBridleLimitState {
    this.limitUntil = monotonicNow() + retryAfterMs
    this.limitWindow = window
    this.armLimitTimer(retryAfterMs)
    return { limited: true, retryAfterMs, ...(window ? { window } : {}) }
  }

  private armLimitTimer(delayMs: number): void {
    if (this.limitTimer) clearTimeout(this.limitTimer)
    this.limitTimer = setTimeout(() => {
      this.limitTimer = null
      if (this.limitUntil === null) return
      // A timer can fire early against the monotonic clock; wait out the rest.
      const left = this.limitUntil - monotonicNow()
      if (left > 0) this.armLimitTimer(left)
      else this.endLimit()
    }, delayMs)
  }

  /** Sending is open again: by time, or because the hub made room early. */
  private endLimit(): void {
    if (this.limitTimer) {
      clearTimeout(this.limitTimer)
      this.limitTimer = null
    }
    this.limitUntil = null
    this.limitWindow = undefined
    this.fire('limit', { limited: false })
  }

  private fire<T>(event: EventName, payload: T): void {
    this.listeners.get(event)?.forEach((fn) => {
      try {
        ;(fn as Listener<T>)(payload)
      } catch (err) {
        console.error(`[bridle] listener for "${event}" threw:`, err)
      }
    })
  }
}

/** Hub codes for a token it no longer accepts — a fresh one may still get in. */
export function isTokenRejection(code: string | undefined): boolean {
  return code === 'TOKEN_EXPIRED' || code === 'INVALID_TOKEN'
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

/**
 * A clock that only moves forward and keeps moving in a background tab. Waits
 * are measured on it, so changing the system time cannot shorten or stretch one.
 */
export function monotonicNow(): number {
  const p = (globalThis as unknown as { performance?: { now?: () => number } }).performance
  return typeof p?.now === 'function' ? p.now() : Date.now()
}

function toWait(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function toWindow(value: unknown): BridleLimitWindow | undefined {
  return value === 'minute' || value === 'hour' || value === 'day' ? value : undefined
}

function withoutFlag(state: IBridleLimitState): { retryAfterMs?: number; window?: BridleLimitWindow } {
  return {
    ...(state.retryAfterMs !== undefined ? { retryAfterMs: state.retryAfterMs } : {}),
    ...(state.window ? { window: state.window } : {}),
  }
}

function toMessage(
  data: unknown,
  role: 'user' | 'assistant',
  streaming?: boolean,
): IBridleMessage {
  const d = (data ?? {}) as Record<string, unknown>
  const text = (d.text as string) ?? ''
  const parts =
    (d.parts as BridlePart[]) ??
    (text ? [{ type: 'text' as const, text }] : [])
  // `kind` marks a frame as a NOTE — the agent's reasoning rather than its
  // answer (docs/PROTOCOL.md § Notes). Unknown values are dropped rather than
  // passed through: the widget switches rendering on this field, and a typo on
  // the runtime side should degrade to a normal bubble, not to a broken one.
  const kind = d.kind === 'thinking' || d.kind === 'tool' ? (d.kind as BridleMessageKind) : undefined

  return {
    id: (d.messageId as string) ?? randomId(),
    role,
    text,
    parts,
    ts: (d.ts as number) ?? Date.now(),
    ...(streaming !== undefined ? { streaming } : {}),
    ...(kind ? { kind } : {}),
  }
}

function randomId(): string {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return 'bridle-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/**
 * Stable anonymous id for token-less public embeds, persisted per agent in
 * localStorage so the same visitor keeps the same transcript channel across
 * reconnects AND page reloads. Returns `undefined` when storage is
 * unavailable (privacy mode, SSR) — the hub then mints an ephemeral id, i.e.
 * the old behavior, so nothing breaks. The value is opaque and unguessable;
 * the hub namespaces it under `anon-` and sanitizes it before use.
 */
function stableAnonId(agentId: string): string | undefined {
  const key = `bridle:anon:${agentId}`
  try {
    const ls = (globalThis as unknown as { localStorage?: Storage }).localStorage
    if (!ls) return undefined
    let id = ls.getItem(key)
    if (!id) {
      id = randomId()
      ls.setItem(key, id)
    }
    return id
  } catch {
    return undefined
  }
}
