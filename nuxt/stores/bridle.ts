import { defineStore } from 'pinia'
import { io, type Socket } from 'socket.io-client'

export interface IBridleMessageData {
  id: string
  role: 'user' | 'assistant'
  text: string
  ts: number
  streaming?: boolean
}

export const useBridleStore = defineStore('bridle', {
  state: () => ({
    messages: [] as IBridleMessageData[],
    isConnected: false,
    isTyping: false,
    isOpen: false,
    clientId: null as string | null,
    _socket: null as Socket | null,
  }),

  getters: {
    getMessages: (state) => state.messages,
    getIsOpen: (state) => state.isOpen,
  },

  actions: {
    connect(apiUrl: string, botId: string, token: string) {
      if (this._socket) return

      const socket = io(`${apiUrl}/ws/chat`, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 2000,
        auth: { token, botId },
      })

      socket.on('connect', () => {
        this.isConnected = true
      })

      socket.on('disconnect', () => {
        this.isConnected = false
      })

      socket.on('connect_error', (err) => {
        this.isConnected = false
        console.error('[bridle] connection error:', err.message)
      })

      socket.on('welcome', (data: { clientId: string }) => {
        this.clientId = data.clientId
      })

      socket.on('message', (data: { text?: string; messageId?: string; ts?: number }) => {
        this.isTyping = false
        this.messages.push({
          id: data.messageId ?? crypto.randomUUID(),
          role: 'assistant',
          text: data.text ?? '',
          ts: data.ts ?? Date.now(),
        })
      })

      socket.on('typing', () => {
        this.isTyping = true
      })

      socket.on('stream', (data: { text?: string; messageId?: string; ts?: number }) => {
        this.isTyping = false
        const idx = this.messages.findIndex(m => m.id === data.messageId)
        if (idx >= 0) {
          this.messages[idx] = { ...this.messages[idx], text: data.text ?? '', streaming: true }
        } else {
          this.messages.push({
            id: data.messageId ?? crypto.randomUUID(),
            role: 'assistant',
            text: data.text ?? '',
            ts: data.ts ?? Date.now(),
            streaming: true,
          })
        }
      })

      socket.on('stream_end', (data: { text?: string; messageId?: string; ts?: number }) => {
        this.isTyping = false
        const idx = this.messages.findIndex(m => m.id === data.messageId)
        if (idx >= 0) {
          this.messages[idx] = { ...this.messages[idx], text: data.text ?? '', streaming: false }
        } else {
          this.messages.push({
            id: data.messageId ?? crypto.randomUUID(),
            role: 'assistant',
            text: data.text ?? '',
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
    },

    sendMessage(text: string, images?: Array<{ base64: string; mediaType: string }>) {
      if (!text.trim()) return

      this.messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        text: text.trim(),
        ts: Date.now(),
      })

      this.isTyping = true

      this._socket?.emit('message', {
        text: text.trim(),
        ...(images?.length ? { images } : {}),
      })
    },

    clearMessages() {
      this.messages = []
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
