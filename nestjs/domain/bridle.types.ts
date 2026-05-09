// ── Part types (wire protocol) ───────────────────────────────

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

// ── Wire protocol messages ───────────────────────────────────

/** Hub → Agent: incoming message from a browser client */
export interface IBridleIncomingMessage {
  type: 'message'
  clientId: string
  agentId: string
  text: string
  messageId: string
  parts: BridlePart[]
}

/** Agent → Hub: events routed to browser clients */
export interface IBridleOutgoingEvent {
  type:
    | 'register'
    | 'message'
    | 'stream'
    | 'stream_end'
    | 'typing'
    | 'ping'
    | 'agent_status'
  clientId?: string
  text?: string
  parts?: BridlePart[]
  messageId?: string
  ts?: number
  /** Set on `agent_status` events emitted by the hub. */
  agentId?: string
  /** Set on `agent_status` events: true when an agent runtime is currently registered. */
  connected?: boolean
}

// ── Admin: debug snapshots ───────────────────────────────────

/**
 * Agent → Hub → Admin browsers only.
 * Carries a snapshot of what was sent to the LLM and what came back, for
 * prompt debugging in an admin UI. The hub fans this out only to clients
 * with `isAdmin === true`. Embedded SDK on public sites never sees this.
 */
export interface IBridleDebugEvent {
  type: 'debug'
  clientId: string
  messageId?: string
  ts: number
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

// ── Admin: sync command ──────────────────────────────────────

/** Hub → Agent: command to push agent's local state to remote storage. */
export interface IBridleSyncRequest {
  type: 'sync'
  requestId: string
}

/** Agent → Hub: ack for a sync command. */
export interface IBridleSyncResponse {
  type: 'sync_done'
  requestId: string
  pushed: number
  error?: string
}

/** Hub → Agent: toggle the agent's debug-snapshot emission. */
export interface IBridleDebugSet {
  type: 'debug_set'
  enabled: boolean
}

// ── Health ───────────────────────────────────────────────────

/** Health check response */
export interface IBridleHealthData {
  ok: boolean
  agentConnected: boolean
  browserClients: number
}

/** Per-agent health check response */
export interface IBridleAgentHealthData {
  ok: boolean
  agentConnected: boolean
  browserClients: number
  agentId: string
}

/** Registered client metadata */
export interface IBridleClientData {
  agentId: string
  send: (data: unknown) => void
  /**
   * True when the JWT carried an admin role. Admin clients receive admin-only
   * events (debug snapshots) in addition to normal messages.
   */
  isAdmin: boolean
}

// ── Helpers ──────────────────────────────────────────────────

/** Extract plain text from parts array */
export function getTextFromParts(parts: BridlePart[]): string {
  return parts
    .filter((p): p is IBridleTextPart => p.type === BridlePartTypes.Text)
    .map(p => p.text)
    .join('')
}

/** Build parts array from flat text + images (backward compat) */
export function buildParts(text: string, images?: Array<{ base64: string; mediaType: string }>): BridlePart[] {
  const parts: BridlePart[] = []
  if (text) {
    parts.push({ type: BridlePartTypes.Text, text })
  }
  if (images) {
    for (const img of images) {
      parts.push({ type: BridlePartTypes.Image, base64: img.base64, mediaType: img.mediaType })
    }
  }
  return parts
}
