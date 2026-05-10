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

export interface IBridleMessageData {
  id: string
  role: 'user' | 'assistant'
  text: string
  parts: BridlePart[]
  ts: number
  streaming?: boolean
}

export interface IBridleConnectionError {
  code: string
  message?: string
  details?: Record<string, unknown>
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

export const useBridleStore = defineStore('bridle', {
  state: () => ({
    messages: [] as IBridleMessageData[],
    isConnected: false,
    isTyping: false,
    isOpen: false,
    clientId: null as string | null,
    connectionError: null as IBridleConnectionError | null,
    _socket: null as Socket | null,
  }),

  getters: {
    getMessages: (state) => state.messages,
    getIsOpen: (state) => state.isOpen,
  },

  actions: {
    connect(apiUrl: string, agentId: string, token: string) {
      if (this._socket) return

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

      socket.on('message', (data: { text?: string; parts?: BridlePart[]; messageId?: string; ts?: number }) => {
        this.isTyping = false
        const text = data.text ?? ''
        const parts = data.parts ?? (text ? [{ type: BridlePartTypes.Text as const, text }] : [])
        if (!hasVisibleContent(text, parts)) return
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
    },

    sendMessage(text: string, images?: Array<{ base64: string; mediaType: string }>) {
      if (!text.trim()) return

      const parts = buildParts(text.trim(), images)

      this.messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        text: text.trim(),
        parts,
        ts: Date.now(),
      })

      this.isTyping = true

      this._socket?.emit('message', { text: text.trim(), parts })
    },

    clearMessages() {
      this.messages = []
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
