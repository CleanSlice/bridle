import { randomUUID } from 'crypto'
import { io, type Socket } from 'socket.io-client'

/**
 * Channel gateway interface — the agent runtime's contract for a messaging channel.
 * Copied from runtime channel domain to keep bridle self-contained.
 */
export interface IChannelGateway {
  readonly name: string
  start(): Promise<void>
  stop(): Promise<void>
  send(to: string, text: string): Promise<void>
  onMessage(handler: (msg: IBridleMessageData) => Promise<void>): void
  streamSend?(to: string, streamer: (onChunk: (text: string) => void) => Promise<string>): Promise<void>
}

export interface IBridleImageData {
  base64: string
  mediaType: string
}

export interface IBridleMessageData {
  id: string
  text: string
  from: string
  channel: string
  ts: number
  images?: IBridleImageData[]
  metadata?: Record<string, unknown>
}

/**
 * Web channel — agent connects TO the NestJS API (bridle hub) as a socket.io client.
 * The API is the hub between browser users and the agent.
 *
 * Flow:  Browser ↔ /ws/chat ↔ NestJS Hub ↔ /ws/agent ↔ Agent (this)
 *
 * Events (Hub → Agent):
 *   "message"  { clientId, text, messageId, images? }
 *   "pong"     {}
 *
 * Events (Agent → Hub):
 *   "register"     {}
 *   "message"      { clientId, text, messageId, ts }
 *   "stream"       { clientId, text, messageId, ts }
 *   "stream_end"   { clientId, text, messageId, ts }
 *   "typing"       { clientId, ts }
 *   "ping"         {}
 */
export class BridleRepository implements IChannelGateway {
  readonly name = 'bridle'

  private handler?: (msg: IBridleMessageData) => Promise<void>
  private socket: Socket | null = null
  private apiUrl: string

  constructor(apiUrl: string) {
    this.apiUrl = apiUrl
  }

  // ── IChannelGateway implementation ──────────────────────────

  async start(): Promise<void> {
    this.connect()
  }

  async stop(): Promise<void> {
    this.socket?.disconnect()
    this.socket = null
    console.log('[bridle] channel stopped')
  }

  async send(to: string, text: string): Promise<void> {
    this.socket?.emit('message', {
      clientId: to,
      text,
      messageId: randomUUID(),
      ts: Date.now(),
    })
  }

  onMessage(handler: (msg: IBridleMessageData) => Promise<void>): void {
    this.handler = handler
  }

  async streamSend(to: string, streamer: (onChunk: (text: string) => void) => Promise<string>): Promise<void> {
    const messageId = randomUUID()

    if (!this.socket?.connected) {
      await streamer(() => {})
      return
    }

    this.socket.emit('typing', { clientId: to, ts: Date.now() })

    let lastSent = ''
    let pendingText = ''
    let sending = false

    const flush = () => {
      if (sending || pendingText === lastSent) return
      sending = true
      const toSend = pendingText
      this.socket?.emit('stream', { clientId: to, text: toSend, messageId, ts: Date.now() })
      lastSent = toSend
      sending = false
    }

    const interval = setInterval(flush, 100)

    let finalText = ''
    try {
      finalText = await streamer((accumulated: string) => {
        pendingText = accumulated
      })
    } finally {
      clearInterval(interval)
      this.socket?.emit('stream_end', { clientId: to, text: finalText, messageId, ts: Date.now() })
    }
  }

  // ── Socket.io client ───────────────────────────────────────

  private connect(): void {
    const url = this.apiUrl
    console.log(`[bridle] connecting to API at ${url}/ws/agent`)

    this.socket = io(`${url}/ws/agent`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 3000,
      reconnectionAttempts: Infinity,
      auth: {
        apiKey: process.env.BRIDLE_API_KEY ?? '',
        botId: process.env.BRIDLE_BOT_ID ?? '',
      },
    })

    this.socket.on('connect', () => {
      console.log('[bridle] connected to API')
      this.socket?.emit('register', {})
    })

    this.socket.on('disconnect', (reason) => {
      console.log(`[bridle] disconnected from API: ${reason}`)
    })

    this.socket.on('reconnect', () => {
      console.log('[bridle] reconnected to API')
      this.socket?.emit('register', {})
    })

    // Incoming messages from browser clients (routed via hub)
    this.socket.on('message', (data: unknown) => {
      const msg = data as Record<string, unknown>
      if (!msg?.text || !msg?.clientId || !this.handler) return

      const images = Array.isArray(msg.images)
        ? (msg.images as Array<Record<string, unknown>>).filter((img) => img.base64 && img.mediaType) as unknown as IBridleImageData[]
        : undefined

      this.handler({
        id: (msg.messageId as string) ?? randomUUID(),
        text: msg.text as string,
        from: msg.clientId as string,
        channel: 'bridle',
        ts: Date.now(),
        ...(images?.length ? { images } : {}),
        metadata: { clientId: msg.clientId, source: 'bridle' },
      }).catch(err => console.error('[bridle] handler error:', err))
    })

    this.socket.on('connect_error', (err) => {
      console.error('[bridle] connection error:', err.message)
    })
  }
}
