export interface IBridleImageData {
  base64: string
  mediaType: string
}

/** Hub → Agent: incoming message from a browser client */
export interface IBridleIncomingMessage {
  type: 'message'
  clientId: string
  botId: string
  text: string
  messageId: string
  images?: IBridleImageData[]
}

/** Agent → Hub: events routed to browser clients */
export interface IBridleOutgoingEvent {
  type: 'register' | 'message' | 'stream' | 'stream_end' | 'typing' | 'ping'
  clientId?: string
  text?: string
  messageId?: string
  ts?: number
}

/** Health check response */
export interface IBridleHealthData {
  ok: boolean
  agentConnected: boolean
  browserClients: number
}

/** Per-bot health check response */
export interface IBridleBotHealthData {
  ok: boolean
  agentConnected: boolean
  browserClients: number
  botId: string
}

/** Registered client metadata */
export interface IBridleClientData {
  botId: string
  send: (data: unknown) => void
}
