import { randomUUID } from 'crypto'
import { io, type Socket } from 'socket.io-client'

// ── Part types (matches wire protocol) ───────────────────────

export enum BridlePartTypes {
  Text = 'text',
  Image = 'image',
  File = 'file',
  Ui = 'ui',
  UiSubmit = 'ui_submit',
}

export interface IBridleTextPart {
  type: BridlePartTypes.Text
  text: string
}

export interface IBridleImagePart {
  type: BridlePartTypes.Image
  base64: string
  mediaType: string
}

export interface IBridleFilePart {
  type: BridlePartTypes.File
  url: string
  name: string
  mimeType?: string
}

// ── Interactive UI parts ─────────────────────────────────────
// Agent sends `ui` parts; the SDK renders them as a form and returns the
// answers as a `ui_submit` part in the next user message. Other channels
// (Telegram, etc.) ignore these parts — the agent should fall back to
// plain text when `msg.capabilities` doesn't include `'ui'`.

export type BridleUiOption = { value: string; label: string }

export type BridleUiComponent =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  | {
      type: 'input'
      name: string
      label?: string
      placeholder?: string
      required?: boolean
      default?: string
    }
  | {
      type: 'textarea'
      name: string
      label?: string
      placeholder?: string
      required?: boolean
      default?: string
    }
  | {
      type: 'radio'
      name: string
      label?: string
      required?: boolean
      default?: string
      options: BridleUiOption[]
    }
  | { type: 'checkbox'; name: string; label: string; default?: boolean }
  | {
      type: 'checkbox-group'
      name: string
      label?: string
      required?: boolean
      default?: string[]
      options: BridleUiOption[]
    }
  | {
      type: 'select'
      name: string
      label?: string
      placeholder?: string
      required?: boolean
      default?: string
      options: BridleUiOption[]
    }

export interface IBridleUiPart {
  type: BridlePartTypes.Ui
  uiId: string
  components: BridleUiComponent[]
  submit?: { label?: string }
}

export type BridleUiValue = string | boolean | string[]

export interface IBridleUiSubmitPart {
  type: BridlePartTypes.UiSubmit
  uiId: string
  values: Record<string, BridleUiValue>
}

export type BridlePart =
  | IBridleTextPart
  | IBridleImagePart
  | IBridleFilePart
  | IBridleUiPart
  | IBridleUiSubmitPart

/**
 * Helper for building a UI part the SDK can render. Generates `uiId` if
 * absent so the agent always knows what to match on submit.
 */
export function buildUiForm(
  components: BridleUiComponent[],
  opts: { uiId?: string; submitLabel?: string } = {},
): IBridleUiPart {
  return {
    type: BridlePartTypes.Ui,
    uiId: opts.uiId ?? `ui-${randomUUID()}`,
    components,
    ...(opts.submitLabel ? { submit: { label: opts.submitLabel } } : {}),
  }
}

// ── Channel gateway interface ────────────────────────────────

export interface IChannelGateway {
  readonly name: string
  start(): Promise<void>
  stop(): Promise<void>
  send(to: string, text: string, parts?: BridlePart[]): Promise<void>
  onMessage(handler: (msg: IBridleMessageData) => Promise<void>): void
  streamSend?(to: string, streamer: (onChunk: (text: string) => void) => Promise<string>): Promise<void>
}

export interface IBridleMessageData {
  id: string
  text: string
  parts: BridlePart[]
  from: string
  channel: string
  ts: number
  metadata?: Record<string, unknown>
  /**
   * Integrator-supplied context attached to the embed (`data-prompt` on the
   * `<script>` tag). Present on every message in this session when the
   * embed page set it. Fold this into the system prompt — it lets the
   * integrator give the agent page/user/tenant context without code changes.
   */
  prompt?: string
  /**
   * What the client SDK can render. Sent at handshake by Bridle (since
   * v0.12.0) and forwarded by the hub on every message. Check this before
   * sending parts that not all channels can render — e.g. `ui` parts only
   * show up when `capabilities.includes('ui')`.
   *
   * Known capabilities (Bridle): `'streaming'`, `'images'`, `'files'`, `'ui'`.
   * Older clients or non-Bridle channels won't set it.
   */
  capabilities?: string[]
}

// ── Admin protocol — debug + sync ─────────────────────────────

/**
 * Snapshot of a single LLM round-trip — what was sent, what came back, plus
 * timing and usage. Pass to `emitDebug()` to fan out to admin browsers.
 */
export interface IBridleDebugSnapshot {
  clientId: string
  messageId?: string
  ts?: number
  model: string
  provider: string
  systemPrompt: string
  history: unknown[]
  response: {
    text: string
    toolCalls?: Array<{ name: string; params: unknown }>
    stopReason?: string
  }
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    credentialId?: string
  }
  latencyMs: number
}

/** Sync handler — return value is acked back to the hub. */
export type SyncHandler = () => Promise<{ pushed: number }>

/** Toggle handler — fired when the hub pushes a debug_set command. */
export type DebugToggleHandler = (enabled: boolean) => void

// ── Repository ───────────────────────────────────────────────

/**
 * Bridle channel — agent connects TO the Bridle hub as a socket.io client.
 * The hub relays messages between browser users and this agent.
 *
 * Flow:  Browser ↔ /ws/client ↔ Bridle Hub ↔ /ws/agent ↔ Agent (this)
 *
 * Events (Hub → Agent):
 *   "message"  { clientId, text, parts, messageId, prompt? }
 *   "pong"     {}
 *
 * Events (Agent → Hub):
 *   "register"     {}
 *   "message"      { clientId, text, parts, messageId, ts }
 *   "stream"       { clientId, text, parts, messageId, ts }
 *   "stream_end"   { clientId, text, parts, messageId, ts }
 *   "typing"       { clientId, ts }
 *   "ping"         {}
 */
export class BridleRepository implements IChannelGateway {
  readonly name = 'bridle'

  private handler?: (msg: IBridleMessageData) => Promise<void>
  private debugToggleHandler?: DebugToggleHandler
  private syncHandler?: SyncHandler
  private socket: Socket | null = null
  private apiUrl: string

  constructor(apiUrl: string) {
    this.apiUrl = apiUrl
  }

  async start(): Promise<void> {
    this.connect()
  }

  async stop(): Promise<void> {
    this.socket?.disconnect()
    this.socket = null
    console.log('[bridle] channel stopped')
  }

  async send(to: string, text: string, parts?: BridlePart[]): Promise<void> {
    const resolvedParts = parts ?? (text ? [{ type: BridlePartTypes.Text as const, text }] : [])
    this.socket?.emit('message', {
      clientId: to,
      text,
      parts: resolvedParts,
      messageId: randomUUID(),
      ts: Date.now(),
    })
  }

  onMessage(handler: (msg: IBridleMessageData) => Promise<void>): void {
    this.handler = handler
  }

  /**
   * Register a callback for hub-pushed debug toggles. The hub sends
   * `debug_set` after an admin flips the debug flag in the dashboard.
   * Use this to gate calls to `emitDebug()` in your runtime.
   */
  onDebugToggle(handler: DebugToggleHandler): void {
    this.debugToggleHandler = handler
  }

  /**
   * Register a handler for the hub's sync command. Resolve with the number
   * of items pushed (or throw to ack as failure). Wire-side ack is sent
   * automatically by the runtime.
   */
  onSync(handler: SyncHandler): void {
    this.syncHandler = handler
  }

  /**
   * Push an LLM round-trip snapshot to the hub. Hub fans it out to admin
   * clients only. No-op if the socket is offline.
   */
  emitDebug(snapshot: IBridleDebugSnapshot): void {
    if (!this.socket?.connected) return
    this.socket.emit('debug', {
      type: 'debug',
      ...snapshot,
      ts: snapshot.ts ?? Date.now(),
    })
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
    let chunksEmitted = 0

    const flush = () => {
      if (sending || pendingText === lastSent) return
      sending = true
      const toSend = pendingText
      this.socket?.emit('stream', {
        clientId: to,
        text: toSend,
        parts: [{ type: BridlePartTypes.Text, text: toSend }],
        messageId,
        ts: Date.now(),
      })
      lastSent = toSend
      chunksEmitted++
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
      // Tool-only LLM iterations stream no text and return ""; emitting
      // stream_end here would create an empty bubble in the UI. Skip when
      // we never streamed anything and have nothing to finalize.
      if (chunksEmitted > 0 || finalText.length > 0) {
        this.socket?.emit('stream_end', {
          clientId: to,
          text: finalText,
          parts: [{ type: BridlePartTypes.Text, text: finalText }],
          messageId,
          ts: Date.now(),
        })
      }
    }
  }

  private connect(): void {
    const url = this.apiUrl
    console.log(`[bridle] connecting to hub at ${url}`)

    this.socket = io(url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 3000,
      reconnectionAttempts: Infinity,
      auth: {
        apiKey: process.env.BRIDLE_API_KEY ?? '',
        agentId: process.env.BRIDLE_AGENT_ID ?? '',
      },
    })

    this.socket.on('connect', () => {
      console.log('[bridle] connected to hub')
      this.socket?.emit('register', {})
    })

    this.socket.on('disconnect', (reason) => {
      console.log(`[bridle] disconnected from hub: ${reason}`)
    })

    this.socket.on('reconnect', () => {
      console.log('[bridle] reconnected to hub')
      this.socket?.emit('register', {})
    })

    this.socket.on('message', (data: unknown) => {
      const msg = data as Record<string, unknown>
      if (!msg?.clientId || !this.handler) return

      const text = (msg.text as string) ?? ''
      const parts = (msg.parts as BridlePart[]) ?? (text ? [{ type: BridlePartTypes.Text, text }] : [])
      const prompt = typeof msg.prompt === 'string' ? msg.prompt : undefined

      this.handler({
        id: (msg.messageId as string) ?? randomUUID(),
        text,
        parts,
        from: msg.clientId as string,
        channel: 'bridle',
        ts: Date.now(),
        metadata: { clientId: msg.clientId, source: 'bridle' },
        ...(prompt ? { prompt } : {}),
      }).catch(err => console.error('[bridle] handler error:', err))
    })

    // Hub → Agent: admin toggled debug. Just notify the runtime; the agent
    // decides what to do with the flag (typically, emit debug snapshots).
    this.socket.on('debug_set', (data: unknown) => {
      const enabled = !!(data as Record<string, unknown> | undefined)?.enabled
      this.debugToggleHandler?.(enabled)
    })

    // Hub → Agent: admin requested a sync. Run the handler, ack with the
    // result. If no handler is registered, ack as zero-pushed so the hub
    // doesn't block.
    this.socket.on('sync', async (data: unknown) => {
      const requestId = (data as Record<string, unknown>)?.requestId as string | undefined
      if (!requestId) return
      try {
        const result = this.syncHandler ? await this.syncHandler() : { pushed: 0 }
        this.socket?.emit('sync_done', {
          type: 'sync_done',
          requestId,
          pushed: result.pushed,
        })
      } catch (err) {
        this.socket?.emit('sync_done', {
          type: 'sync_done',
          requestId,
          pushed: 0,
          error: (err as Error).message ?? 'sync failed',
        })
      }
    })

    this.socket.on('connect_error', (err) => {
      console.error('[bridle] connection error:', err.message)
    })
  }
}
