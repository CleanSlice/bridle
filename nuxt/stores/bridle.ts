import { defineStore } from 'pinia'
import { io, type Socket } from 'socket.io-client'

export enum BridlePartTypes {
  Text = 'text',
  Image = 'image',
  File = 'file',
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

export type BridlePart = IBridleTextPart | IBridleImagePart | IBridleFilePart

// ── Work log (the agent's reasoning) ──────────────────────────
// An agent that reasons out loud sends those lines as ordinary `message`
// frames DURING a turn. They are not the answer and must not be drawn as
// one; the Provider folds every note of a turn into a single collapsible
// row above the answer. See docs/PROTOCOL.md § Notes (agent reasoning).

/** What a `message` frame is, when it is not the answer. */
export type BridleMessageKind = 'thinking' | 'tool'

/** One line of the work log. */
export interface IBridleThinkingStep {
  id: string
  text: string
  /** `tool` steps are the agent reaching for something, not thinking about it. */
  kind: BridleMessageKind
  /** The last step of a live log is still running; everything else is done. */
  running: boolean
}

export interface IBridleMessageData {
  id: string
  role: 'user' | 'assistant'
  text: string
  parts: BridlePart[]
  ts: number
  streaming?: boolean
  /**
   * Present ONLY on a work-log entry — a synthetic assistant message holding
   * the notes of one turn instead of an answer. `text`/`parts` stay empty on
   * it, so anything walking the transcript for content skips it.
   */
  steps?: IBridleThinkingStep[]
  /** The turn that produced this work log is still running. */
  live?: boolean
}

export interface IBridleConnectionError {
  code: string
  message?: string
  details?: Record<string, unknown>
}

// ── Request limits ────────────────────────────────────────────
// A hub may cap how many requests an agent takes per minute, hour and day.
// A full window is a state to wait out, not an error: it arrives in the
// acknowledgement of a send and in the `agent_limit` event, never in
// `bridle_error`. See docs/PROTOCOL.md § Request limits.

/** The window that set the wait. */
export type BridleLimitWindow = 'minute' | 'hour' | 'day'

/** What the hub answers to a `message` that carried a `clientMessageId`. */
export type BridleSendAck =
  | { status: 'accepted'; messageId: string; ts?: number; duplicate?: boolean }
  | {
      status: 'rejected'
      code: string
      message?: string
      /** `RATE_LIMITED` only. */
      retryAfterMs?: number
      /** `RATE_LIMITED` only. */
      window?: BridleLimitWindow
    }

/** A message the hub refused because the limit is full, for the composer to take back. */
export interface IBridleReturnedDraft {
  id: string
  text: string
}

/**
 * What the hub sends, as a `message`, to a visitor whose agent is not
 * connected — unless the client asked for an acknowledgement, in which case
 * it gets `AGENT_OFFLINE` there and says the line itself.
 */
const AGENT_OFFLINE_TEXT = 'Agent is not connected. Please try again later.'

/**
 * A clock that only moves forward and keeps moving in a background tab, so a
 * wrong wall clock cannot shorten or stretch a wait.
 */
function monotonicNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function buildParts(text: string, images?: Array<{ base64: string; mediaType: string }>): BridlePart[] {
  const parts: BridlePart[] = []
  if (text) parts.push({ type: BridlePartTypes.Text, text })
  if (images) {
    for (const img of images) {
      parts.push({ type: BridlePartTypes.Image, base64: img.base64, mediaType: img.mediaType })
    }
  }
  return parts
}

// Tool-only LLM iterations cause the runtime's bridle channel to emit
// stream/stream_end events with empty text. Without this guard each one
// renders as an empty chat bubble.
function hasVisibleContent(text: string, parts: BridlePart[]): boolean {
  if (text && text.trim().length > 0) return true
  return parts.some(p => {
    if (p.type === BridlePartTypes.Image || p.type === BridlePartTypes.File) return true
    return p.type === BridlePartTypes.Text && p.text.trim().length > 0
  })
}

/**
 * Is this `message` frame a note rather than an answer, and of which kind?
 *
 * Two ways it can be known, in this order: the runtime marked it, or it
 * arrived while a turn was open. Unknown `kind` values fall through to the
 * mid-turn rule instead of being trusted — a typo on the runtime side should
 * degrade to an ordinary bubble, never to a broken one.
 */
function noteKind(kind: string | undefined, turnOpen: boolean, text: string): BridleMessageKind | null {
  if (kind === 'thinking' || kind === 'tool') return kind
  if (!turnOpen) return null
  // Tool notes are conventionally an arrow and a name (`→ searchWeb`);
  // everything else reads as a thought.
  return text.trimStart().startsWith('\u2192') ? 'tool' : 'thinking'
}

export const useBridleStore = defineStore('bridle', {
  state: () => ({
    messages: [] as IBridleMessageData[],
    isConnected: false,
    isTyping: false,
    isOpen: false,
    clientId: null as string | null,
    connectionError: null as IBridleConnectionError | null,
    /** The work-log entry being filled, or null between turns. */
    _logId: null as string | null,
    /** A turn is running: `typing` was raised and nothing has closed it yet. */
    _turnOpen: false,
    _socket: null as Socket | null,
    /**
     * When the agent's request limit opens again, on the `performance.now()`
     * clock. Null while sending is open.
     */
    limitUntil: null as number | null,
    limitWindow: null as BridleLimitWindow | null,
    /** What is left of the wait, refreshed once a second for the notice. */
    limitRemainingMs: 0,
    /** The last message the hub refused for the limit; the composer takes its text back. */
    returnedDraft: null as IBridleReturnedDraft | null,
    _limitTimer: null as ReturnType<typeof setTimeout> | null,
    /** The agent the wait above belongs to. */
    _limitAgentId: null as string | null,
  }),

  getters: {
    getMessages: (state) => state.messages,
    getIsOpen: (state) => state.isOpen,
    /** The agent's request limit is full: nothing can be sent until it opens. */
    isLimited: (state) => state.limitUntil !== null,
  },

  actions: {
    connect(apiUrl: string, agentId: string, token: string) {
      if (this._socket) return

      // The store is one per app. A wait held for another agent does not
      // apply to this one; a wait for the same agent picks its countdown up.
      if (this._limitAgentId !== agentId) {
        this.endLimit()
        this.returnedDraft = null
        this._limitAgentId = agentId
      } else {
        this.tickLimit()
      }

      const socket = io(`${apiUrl}/ws/client`, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 2000,
        auth: { token, agentId },
      })

      socket.on('connect', () => {
        this.isConnected = true
        this.connectionError = null
      })

      socket.on('disconnect', () => {
        this.isConnected = false
      })

      socket.on('connect_error', (err) => {
        this.isConnected = false
        this.connectionError = { code: 'TRANSPORT_ERROR', message: err.message }
        console.error('[bridle] connection error:', err.message)
      })

      // Hub rejects bad handshakes (origin not whitelisted, missing/invalid
      // token, …) by emitting a structured reason just before disconnect.
      socket.on('bridle_error', (data: { code?: string } & Record<string, unknown>) => {
        const { code, ...details } = data ?? {}
        this.connectionError = { code: code ?? 'UNKNOWN', details }
      })

      socket.on('welcome', (data: { clientId: string }) => {
        this.clientId = data.clientId
      })

      socket.on('message', (data: { text?: string; parts?: BridlePart[]; messageId?: string; ts?: number; kind?: string }) => {
        const text = data.text ?? ''
        const parts = data.parts ?? (text ? [{ type: BridlePartTypes.Text as const, text }] : [])
        if (!hasVisibleContent(text, parts)) return

        // A NOTE — the agent's reasoning, not its answer. Either the runtime
        // said so (`kind`), or the frame arrived mid-turn, which by the
        // protocol's own rule is the same statement: a runtime raises
        // `typing` when an ANSWER is coming and closes with `stream_end`, so
        // whatever it sends in between is not that answer.
        const kind = noteKind(data.kind, this._turnOpen, text)
        if (kind) {
          // The indicator stays up: the agent is still working, and the line
          // it just wrote is the evidence.
          this.pushStep(data.messageId ?? crypto.randomUUID(), text, kind, data.ts ?? Date.now())
          return
        }

        this.isTyping = false
        this.settleLog()
        this.messages.push({
          id: data.messageId ?? crypto.randomUUID(),
          role: 'assistant',
          text,
          parts,
          ts: data.ts ?? Date.now(),
        })
      })

      socket.on('typing', () => {
        this.isTyping = true
        this._turnOpen = true
      })

      // An hour or day window of the agent is full, or room was made before
      // the announced time. Sent right after `welcome` and whenever it
      // changes, so the wait is known before anything is typed.
      socket.on('agent_limit', (data: { agentId?: string; limited?: boolean; retryAfterMs?: number; window?: BridleLimitWindow }) => {
        if (!data || (data.agentId && data.agentId !== agentId)) return
        if (data.limited === true && typeof data.retryAfterMs === 'number' && data.retryAfterMs > 0) {
          this.startLimit(data.retryAfterMs, data.window ?? null)
        } else if (data.limited === false) {
          this.endLimit()
        }
      })

      socket.on('stream', (data: { text?: string; parts?: BridlePart[]; messageId?: string; ts?: number }) => {
        this.isTyping = false
        const text = data.text ?? ''
        const parts = data.parts ?? (text ? [{ type: BridlePartTypes.Text as const, text }] : [])
        const idx = this.messages.findIndex(m => m.id === data.messageId)
        if (idx >= 0) {
          this.messages[idx] = { ...this.messages[idx], text, parts, streaming: true }
        } else {
          // Don't create a fresh bubble for an empty initial chunk — wait
          // until the runtime actually has visible content.
          if (!hasVisibleContent(text, parts)) return
          this.messages.push({
            id: data.messageId ?? crypto.randomUUID(),
            role: 'assistant',
            text,
            parts,
            ts: data.ts ?? Date.now(),
            streaming: true,
          })
        }
      })

      socket.on('stream_end', (data: { text?: string; parts?: BridlePart[]; messageId?: string; ts?: number }) => {
        this.isTyping = false
        this.settleLog()
        const text = data.text ?? ''
        const parts = data.parts ?? (text ? [{ type: BridlePartTypes.Text as const, text }] : [])
        const idx = this.messages.findIndex(m => m.id === data.messageId)
        if (idx >= 0) {
          this.messages[idx] = { ...this.messages[idx], text, parts, streaming: false }
        } else {
          if (!hasVisibleContent(text, parts)) return
          this.messages.push({
            id: data.messageId ?? crypto.randomUUID(),
            role: 'assistant',
            text,
            parts,
            ts: data.ts ?? Date.now(),
          })
        }
      })

      this._socket = socket
    },

    disconnect() {
      this._socket?.disconnect()
      this._socket = null
      this.isConnected = false
      this.connectionError = null
      // The wait is the agent's, not the connection's: "New chat" reconnects
      // and must find it still standing. Only the ticking stops here, so no
      // timer outlives the component; `connect()` starts it again.
      if (this._limitTimer) {
        clearTimeout(this._limitTimer)
        this._limitTimer = null
      }
    },

    /** Hold sending for `retryAfterMs`. The latest word from the hub wins. */
    startLimit(retryAfterMs: number, window: BridleLimitWindow | null) {
      this.limitUntil = monotonicNow() + retryAfterMs
      this.limitWindow = window
      this.tickLimit()
    },

    /**
     * Re-read the deadline: refresh the remaining wait, or open sending when
     * it has passed. Runs once a second while limited; call it as well when
     * the tab becomes visible, since background timers are throttled.
     */
    tickLimit() {
      if (this._limitTimer) {
        clearTimeout(this._limitTimer)
        this._limitTimer = null
      }
      if (this.limitUntil === null) return
      const left = this.limitUntil - monotonicNow()
      if (left <= 0) {
        this.endLimit()
        return
      }
      this.limitRemainingMs = left
      this._limitTimer = setTimeout(() => this.tickLimit(), left % 1000 || 1000)
    },

    /** Sending is open again — by time, or because the hub made room early. */
    endLimit() {
      if (this._limitTimer) {
        clearTimeout(this._limitTimer)
        this._limitTimer = null
      }
      this.limitUntil = null
      this.limitWindow = null
      this.limitRemainingMs = 0
    },

    /** Append one note to this turn's work log, opening the log if needed. */
    pushStep(id: string, text: string, kind: BridleMessageKind, ts: number) {
      const log = this._logId ? this.messages.find(m => m.id === this._logId) : undefined
      if (!log?.steps) {
        this._logId = `log-${id}`
        this.messages.push({
          id: this._logId,
          role: 'assistant',
          text: '',
          parts: [],
          ts,
          live: true,
          steps: [{ id, text: text.trim(), kind, running: true }],
        })
        return
      }
      // Only the newest step is in flight; the one before it has just finished.
      for (const step of log.steps) step.running = false
      log.steps.push({ id, text: text.trim(), kind, running: true })
      log.live = true
    },

    /**
     * Close the turn's work log: nothing is running any more.
     *
     * Called when the answer ends AND when the visitor speaks again — the
     * second one matters because a turn that wrote notes and then died
     * (socket drop, runtime crash) would otherwise spin for the rest of the
     * session.
     */
    settleLog() {
      const log = this._logId ? this.messages.find(m => m.id === this._logId) : undefined
      if (log?.steps) {
        for (const step of log.steps) step.running = false
        log.live = false
      }
      this._logId = null
      this._turnOpen = false
    },

    /**
     * Send one message. Returns false, and sends nothing, while the agent's
     * request limit is full.
     *
     * The bubble is drawn at once and the hub is asked to acknowledge the
     * message. If it answers `RATE_LIMITED` the bubble is taken back, the
     * typing dots stop, the wait starts and the text is offered to the
     * composer through `returnedDraft`. A hub that does not acknowledge never
     * calls back, and the message stands as it always did.
     */
    sendMessage(text: string, images?: Array<{ base64: string; mediaType: string }>): boolean {
      if (!text.trim()) return false
      if (this.limitUntil !== null) {
        this.tickLimit()
        if (this.limitUntil !== null) return false
      }

      // The previous turn is over the moment the visitor speaks again,
      // whatever the runtime did or failed to do with it.
      this.settleLog()

      const parts = buildParts(text.trim(), images)
      // The bubble's id travels as `clientMessageId`; the hub keeps it as the
      // message id end to end.
      const id = crypto.randomUUID()
      const wasTyping = this.isTyping

      this.messages.push({
        id,
        role: 'user',
        text: text.trim(),
        parts,
        ts: Date.now(),
      })

      this.isTyping = true

      this._socket?.emit(
        'message',
        { text: text.trim(), parts, clientMessageId: id },
        (ack: BridleSendAck | undefined) => {
          if (!ack || ack.status !== 'rejected') return
          if (ack.code === 'RATE_LIMITED') {
            this.messages = this.messages.filter(m => m.id !== id)
            this.isTyping = wasTyping
            this.startLimit(ack.retryAfterMs && ack.retryAfterMs > 0 ? ack.retryAfterMs : 1000, ack.window ?? null)
            this.returnedDraft = { id, text: text.trim() }
            return
          }
          // Not delivered for another reason: the agent is not working on it.
          this.isTyping = wasTyping
          if (ack.code === 'AGENT_OFFLINE') {
            const line = ack.message ?? AGENT_OFFLINE_TEXT
            this.messages.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              text: line,
              parts: [{ type: BridlePartTypes.Text, text: line }],
              ts: Date.now(),
            })
          }
        },
      )
      return true
    },

    clearMessages() {
      this.messages = []
      this.settleLog()
    },

    async loadTranscript(apiUrl: string, agentId: string, token: string, channel = 'admin') {
      try {
        const url = `${apiUrl.replace(/\/$/, '')}/api/agent/${encodeURIComponent(agentId)}/transcript?channel=${encodeURIComponent(channel)}`
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          console.warn('[bridle] transcript fetch returned', res.status)
          return
        }
        type TranscriptMessage = { id: string; role: 'user' | 'assistant'; text: string; ts: number }
        type TranscriptPayload = { messages?: TranscriptMessage[] }
        type TranscriptEnvelope = { data?: TranscriptPayload }
        const body = await res.json() as TranscriptEnvelope & TranscriptPayload
        const items = body.data?.messages ?? body.messages ?? []
        this.messages = items.map((m: TranscriptMessage) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          parts: [{ type: BridlePartTypes.Text as const, text: m.text }],
          ts: m.ts,
        }))
      } catch (err) {
        console.warn('[bridle] failed to load transcript', err)
      }
    },

    async resetTranscript(apiUrl: string, agentId: string, token: string, channel = 'admin') {
      const url = `${apiUrl.replace(/\/$/, '')}/api/agent/${encodeURIComponent(agentId)}/transcript?channel=${encodeURIComponent(channel)}`
      try {
        const res = await fetch(url, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          console.warn('[bridle] transcript reset returned', res.status)
          return false
        }
        this.messages = []
        return true
      } catch (err) {
        console.warn('[bridle] failed to reset transcript', err)
        return false
      }
    },

    toggle() {
      this.isOpen = !this.isOpen
    },

    open() {
      this.isOpen = true
    },

    close() {
      this.isOpen = false
    },
  },
})
