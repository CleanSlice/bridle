import { io, type Socket } from 'socket.io-client'
import type { BridlePart, IBridleMessage } from './types'

export interface IBridleClientOptions {
  apiUrl: string
  agentId: string
  /**
   * JWT for authenticated bots. Omit when the bot is public on the hub —
   * the connection is then authorized by the request `Origin` header.
   */
  token?: string | (() => string | Promise<string>)
  /** Optional channel for transcript scoping (default: 'web'). */
  channel?: string
  /**
   * Extra context attached at handshake time (`data-prompt` on the embed).
   * The hub forwards it on every outgoing message to the agent so the
   * runtime can fold it into the system prompt or treat it as session
   * metadata. Static for the lifetime of the connection.
   */
  prompt?: string
}

type EventName = 'open' | 'close' | 'error' | 'typing' | 'message' | 'stream' | 'stream_end' | 'welcome'
type Listener<T = unknown> = (payload: T) => void

/**
 * Structured connection rejection from the hub. Lets embed UIs distinguish
 * a misconfigured integration (origin not whitelisted, missing token) from
 * a generic transport error so they can show actionable messages.
 *
 * Codes mirror `bridle_error.code` on the wire:
 *   - `MISSING_AGENT_ID`    — embed didn't pass `agentId`
 *   - `ORIGIN_NOT_ALLOWED`  — agent is public but this origin isn't whitelisted
 *   - `MISSING_TOKEN`       — agent is private and no JWT was provided
 *   - `INVALID_TOKEN`       — JWT failed verification
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
 *   const client = new BridleClient({ apiUrl, agentId, token })
 *   client.on('message', (m) => console.log(m.text))
 *   await client.connect()
 *   client.send('hello')
 */
export class BridleClient {
  private socket: Socket | null = null
  private listeners = new Map<EventName, Set<Listener<any>>>()
  private clientId: string | null = null

  constructor(private opts: IBridleClientOptions) {}

  async connect(): Promise<void> {
    if (this.socket) return
    const token =
      typeof this.opts.token === 'function'
        ? await this.opts.token()
        : (this.opts.token ?? '')
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
    const capabilities = ['streaming', 'images', 'files', 'ui']
    const socket = io(`${url}/ws/client`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
      auth: {
        token,
        agentId: this.opts.agentId,
        capabilities,
        ...(anonId ? { anonId } : {}),
        ...(prompt ? { prompt } : {}),
      },
    })

    socket.on('connect', () => this.fire('open', undefined))
    socket.on('disconnect', () => this.fire('close', undefined))
    socket.on('connect_error', (err: Error) => this.fire('error', err))
    socket.on(
      'bridle_error',
      (data: { code: string } & Record<string, unknown>) => {
        const { code, ...rest } = data ?? { code: 'UNKNOWN' }
        this.fire('error', new BridleAuthError(code ?? 'UNKNOWN', rest))
      },
    )
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

    this.socket = socket
  }

  send(text: string, parts?: BridlePart[]): void {
    if (!this.socket) throw new Error('[bridle] client not connected — call connect() first')
    const trimmed = text.trim()
    const resolvedParts = parts ?? (trimmed ? [{ type: 'text' as const, text: trimmed }] : [])
    this.socket.emit('message', { text: trimmed, parts: resolvedParts })
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
  }

  on(event: 'open' | 'close' | 'typing', handler: () => void): void
  on(event: 'error', handler: (error: Error) => void): void
  on(event: 'welcome', handler: (data: { clientId: string }) => void): void
  on(event: 'message' | 'stream' | 'stream_end', handler: (message: IBridleMessage) => void): void
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
  return {
    id: (d.messageId as string) ?? randomId(),
    role,
    text,
    parts,
    ts: (d.ts as number) ?? Date.now(),
    ...(streaming !== undefined ? { streaming } : {}),
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
