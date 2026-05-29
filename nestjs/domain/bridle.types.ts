// ── Part types (wire protocol) ───────────────────────────────

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
// Agent → Browser as `ui`, Browser → Agent as `ui_submit`.
// The hub treats them as opaque payload — parts are forwarded as-is.

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

// ── Wire protocol messages ───────────────────────────────────

/** Hub → Agent: incoming message from a browser client */
export interface IBridleIncomingMessage {
  type: 'message'
  clientId: string
  agentId: string
  text: string
  messageId: string
  parts: BridlePart[]
  /**
   * Optional integrator-supplied context attached at handshake time
   * (`data-prompt` on the embed script). The hub forwards it on every message
   * to the agent so the runtime can fold it into the system prompt or treat
   * it as session metadata. Empty/unset = no extra context.
   */
  prompt?: string
  /**
   * Client capabilities advertised at handshake (`auth.capabilities` on
   * Socket.IO connect). Forwarded on every message so the agent can pick
   * which part types it's safe to emit — e.g. `ui` parts only when the
   * client supports them. Bridle SDK ≥ v0.12.0 sends
   * `['streaming', 'images', 'files', 'ui']`.
   */
  capabilities?: string[]
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
  /**
   * Integrator-supplied context (from `data-prompt`) attached on registration.
   * Forwarded on every outgoing message to the agent.
   */
  prompt?: string
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
