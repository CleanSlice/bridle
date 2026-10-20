// Wire-format types that match bridle/nestjs/domain/bridle.types.ts.
// Kept in sync manually — the hub is the source of truth.

export type BridlePart =
  | { type: 'text'; text: string }
  | { type: 'image'; base64: string; mediaType: string }
  | { type: 'file'; url: string; name: string; mimeType?: string }
  | IBridleUiPart
  | IBridleUiSubmitPart
  | IBridleContextPart

// ── Context part ─────────────────────────────────────────────
// What a message is about, beside what it says: the block of a page the
// person pointed at, the record they had open. Drawn as a plaque above the
// words, never as words. Whoever sends it chose the label; bridle only draws
// it. Producing it — and taking it back out of a stored transcript — is the
// integrator's business. See docs/PROTOCOL.md § Context Part.

export interface IBridleContextPart {
  type: 'context'
  /** What it is, short: "Hero", "Order #1042". */
  label: string
  /** An excerpt of it, when there is one. */
  text?: string
}

// ── Interactive UI parts ──────────────────────────────────────
// Agent → Browser: render an interactive form inside a bubble.
// Browser → Agent: ship the submitted values back, scoped by uiId.

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
  | {
      type: 'checkbox'
      name: string
      label: string
      default?: boolean
    }
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
  type: 'ui'
  /** Stable identifier the agent uses to match the eventual submit. Required. */
  uiId: string
  /** Ordered list of UI components rendered inside the form. */
  components: BridleUiComponent[]
  /** Submit button override. Default label: "Apply". */
  submit?: { label?: string }
}

export type BridleUiValue = string | boolean | string[]

export interface IBridleUiSubmitPart {
  type: 'ui_submit'
  /** Echoes back the `uiId` from the original `ui` part. */
  uiId: string
  /** Map of field `name` → value collected from the form. */
  values: Record<string, BridleUiValue>
}

// ── Work log (the agent's reasoning) ──────────────────────────
// An agent that reasons out loud sends those lines as `message` frames
// DURING a turn. They are not the answer and must not land in the answer's
// bubble; the widget folds them into one collapsible work-log entry above it.
// See docs/PROTOCOL.md § Notes (agent reasoning).

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

export interface IBridleMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  parts: BridlePart[]
  ts: number
  /** True between `stream` and `stream_end` events. */
  streaming?: boolean
  /**
   * Present ONLY on a work-log entry — a synthetic assistant message that
   * holds the notes of one turn instead of an answer. `text`/`parts` stay
   * empty on it, so anything walking the transcript for content skips it.
   */
  steps?: IBridleThinkingStep[]
  /** The turn that produced this work log is still running. */
  live?: boolean
  /** Set on incoming frames the runtime marked as a note. */
  kind?: BridleMessageKind
}

export interface IBridleInitOptions {
  /**
   * Hub origin, e.g. `https://hub.example.com`. If omitted, the SDK infers it
   * from the origin of the loading <script> tag — only works when the SDK is
   * served from the same origin as the hub.
   */
  apiUrl?: string
  /** Agent identifier registered on the hub (`BRIDLE_AGENT_ID` on the runtime). */
  agentId: string
  /**
   * JWT used to authenticate the browser to the hub. Pass a string for static
   * tokens, or a function returning a string/Promise<string> for refresh.
   * Omit when the bot is configured as public on the hub — the hub will
   * accept the connection based on the request `Origin` header.
   */
  token?: string | (() => string | Promise<string>)
  /**
   * Extra context attached at handshake (`data-prompt` on the embed script).
   * The hub forwards it on every outgoing message to the agent — useful for
   * page-specific or user-specific context the integrator wants the agent
   * to know about (current URL, user plan, locale, etc.).
   */
  prompt?: string
  /**
   * Where to mount the chat element. Defaults to <body>.
   * Accepts a CSS selector string or an HTMLElement.
   */
  mount?: string | HTMLElement
  /**
   * Floating bubble in the corner (default) or inline inside `mount`.
   */
  mode?: 'floating' | 'inline'
  /** Header text. Default: "Agent Chat". */
  title?: string
  /** Input placeholder. Default: "Type a message...". */
  placeholder?: string
  /**
   * Built-in palette. `default` is a neutral blue/grey; `cleanslice` matches
   * the CleanSlice teal/cyan palette. Default: `default`.
   */
  theme?: 'default' | 'cleanslice'
  /**
   * Color scheme. `auto` (default) follows the host page — `<html class="dark">`
   * first, then `prefers-color-scheme`. Pass `light` or `dark` to force one.
   */
  colorMode?: 'auto' | 'light' | 'dark'
  /**
   * CSS custom-property overrides applied on top of the chosen theme.
   * Example: `{ '--bridle-primary': '#0070f3' }`.
   */
  themeVars?: Record<string, string>
  /**
   * Extra CSS injected into the chat element's shadow root. Use this when
   * `themeVars` isn't enough — e.g. to restyle `.bridle__panel`,
   * `.bridle__bubble`, or any internal class. Ordinary host-page CSS can't
   * cross the shadow boundary; this string can.
   */
  customCss?: string
  /**
   * Stylesheet URL(s) loaded inside the shadow root via `<link rel="stylesheet">`.
   * Same use-case as `customCss` but kept in an external file you can cache.
   */
  stylesheets?: string | string[]
  /**
   * URL of the icon shown on the floating FAB in place of the built-in
   * chat-bubble glyph. Any URL the browser can render in `<img>` works —
   * `.svg`, `.png`, `.webp`, or a `data:` URI. Floating mode only.
   */
  fabIcon?: string
  /**
   * Welcome message shown by the agent the first time the chat is opened
   * on an empty transcript. Rendered as a normal assistant bubble after a
   * brief typing-indicator delay (see `greetingDelay`). Suppressed if the
   * transcript already has messages or the user sends something during
   * the delay. Markdown is supported.
   */
  greeting?: string
  /**
   * Milliseconds of typing indicator before `greeting` appears.
   * Default: 3000. Set to 0 to skip the delay.
   */
  greetingDelay?: number
  /**
   * URL of an avatar image shown on the empty-state screen, above the
   * `emptyTitle`. Any URL the browser can render in `<img>` works.
   */
  emptyAvatar?: string
  /** Headline shown on the empty-state screen, e.g. "What can I help with?". */
  emptyTitle?: string
  /** Sub-line shown under `emptyTitle`. */
  emptySubtitle?: string
  /**
   * Preset suggestion chips rendered on the empty state. Clicking one
   * sends it as a regular user message. The whole empty state disappears
   * as soon as the conversation begins.
   *
   * Pass `string[]` programmatically. On script tags use
   * `data-suggestions="Q1|Q2|Q3"` (pipe-separated, or a JSON array
   * string — both are accepted).
   */
  suggestions?: string[]
  /**
   * Caption of the collapsed work-log row — the block that holds the agent's
   * reasoning while it works. Default: "Work log". Pass an empty string to
   * drop the reasoning entirely and show answers only.
   */
  thinkingLabel?: string
  /** Hooks for headless side effects in addition to the UI. */
  onReady?: () => void
  onMessage?: (message: IBridleMessage) => void
  onError?: (error: Error) => void
}

export interface IBridleInstance {
  /** Underlying custom element. Useful for further DOM manipulation. */
  element: HTMLElement
  /** Open the panel (floating mode). */
  open: () => void
  /** Close the panel (floating mode). */
  close: () => void
  /** Programmatically send a user message. */
  sendMessage: (text: string) => void
  /** Tear down the widget and disconnect. */
  destroy: () => void
}
