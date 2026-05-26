// Wire-format types that match bridle/nestjs/domain/bridle.types.ts.
// Kept in sync manually — the hub is the source of truth.

export type BridlePart =
  | { type: 'text'; text: string }
  | { type: 'image'; base64: string; mediaType: string }
  | { type: 'file'; url: string; name: string; mimeType?: string }

export interface IBridleMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  parts: BridlePart[]
  ts: number
  /** True between `stream` and `stream_end` events. */
  streaming?: boolean
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
