import { io, type Socket } from 'socket.io-client'
import type { BridlePart, IBridleMessage } from './types'

export interface IBridleClientOptions {
  apiUrl: string
  botId: string
  /**
   * JWT for authenticated bots. Omit when the bot is public on the hub —
   * the connection is then authorized by the request `Origin` header.
   */
  token?: string | (() => string | Promise<string>)
  /** Optional channel for transcript scoping (default: 'web'). */
  channel?: string
}

type EventName = 'open' | 'close' | 'error' | 'typing' | 'message' | 'stream' | 'stream_end' | 'welcome'
type Listener<T = unknown> = (payload: T) => void

/**
 * Headless Bridle client. Use this directly when you want the wire-level
 * behavior (connect / send / stream) without the embedded UI.
 *
 * @example
 *   const client = new BridleClient({ apiUrl, botId, token })
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

    const socket = io(`${url}/ws/chat`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
      auth: { token, botId: this.opts.botId },
    })

    socket.on('connect', () => this.fire('open', undefined))
    socket.on('disconnect', () => this.fire('close', undefined))
    socket.on('connect_error', (err: Error) => this.fire('error', err))
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
