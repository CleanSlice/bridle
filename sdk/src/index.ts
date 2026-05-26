import { defineCustomElement } from 'vue'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — Vite resolves .ce.vue, tsc dts pass doesn't know about it
import BridleChat from './BridleChat.ce.vue'
import { BridleClient, BridleAuthError } from './client'
import type { IBridleInitOptions, IBridleInstance, IBridleMessage } from './types'

// Capture the script tag synchronously at module load — `document.currentScript`
// is null after the IIFE finishes, so we can't read it lazily for auto-mount or
// origin inference.
const _selfScript: HTMLScriptElement | null =
  typeof document !== 'undefined'
    ? (document.currentScript as HTMLScriptElement | null)
    : null

const ELEMENT_TAG = 'bridle-chat'

const BridleElement = defineCustomElement(BridleChat as Parameters<typeof defineCustomElement>[0])

function register(): void {
  if (typeof customElements === 'undefined') return
  if (customElements.get(ELEMENT_TAG)) return
  customElements.define(ELEMENT_TAG, BridleElement)
}

function inferApiUrl(): string | undefined {
  const script = _selfScript ?? findOwnScript()
  if (!script?.src) return undefined
  try {
    return new URL(script.src).origin
  } catch {
    return undefined
  }
}

function findOwnScript(): HTMLScriptElement | undefined {
  if (typeof document === 'undefined') return undefined
  const scripts = document.querySelectorAll<HTMLScriptElement>('script[src]')
  for (const s of Array.from(scripts)) {
    if (/\/bridle(\.[\w.-]+)?\.js(\?.*)?$/.test(s.src)) return s
  }
  return undefined
}

function applyThemeVars(el: HTMLElement, vars: Record<string, string> | undefined): void {
  if (!vars) return
  for (const [k, v] of Object.entries(vars)) {
    el.style.setProperty(k.startsWith('--') ? k : `--${k}`, v)
  }
}

// Inject embedder-supplied CSS into the element's shadow root. CSS custom
// properties cross the shadow boundary, but ordinary selectors don't — so
// `themeVars` can't restyle `.bridle__panel`. This injection covers that gap.
// Vue's defineCustomElement attaches the shadow root in connectedCallback,
// so by the time we're called (after appendChild) `el.shadowRoot` is ready.
function injectCustomStyles(
  el: HTMLElement,
  css: string | undefined,
  stylesheets: string | string[] | undefined,
): void {
  const root = el.shadowRoot
  if (!root) return
  if (css) {
    const style = document.createElement('style')
    style.dataset.bridleCustom = ''
    style.textContent = css
    root.appendChild(style)
  }
  const urls = Array.isArray(stylesheets)
    ? stylesheets
    : stylesheets
      ? [stylesheets]
      : []
  for (const href of urls) {
    if (!href) continue
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.dataset.bridleCustom = ''
    root.appendChild(link)
  }
}

function init(opts: IBridleInitOptions): IBridleInstance {
  if (typeof document === 'undefined') {
    throw new Error('[bridle] init() can only run in a browser')
  }
  if (!opts.agentId) throw new Error('[bridle] agentId is required')

  register()

  const apiUrl = (opts.apiUrl ?? inferApiUrl())?.replace(/\/$/, '')
  if (!apiUrl) {
    throw new Error(
      '[bridle] apiUrl is required (or load the SDK from the same origin as the hub).',
    )
  }

  const el = document.createElement(ELEMENT_TAG) as HTMLElement & {
    open?: () => void
    close?: () => void
    sendMessage?: (text: string) => void
  }
  el.setAttribute('api-url', apiUrl)
  el.setAttribute('agent-id', opts.agentId)
  if (opts.mode) el.setAttribute('mode', opts.mode)
  if (opts.title) el.setAttribute('title', opts.title)
  if (opts.placeholder) el.setAttribute('placeholder', opts.placeholder)
  if (opts.theme) el.setAttribute('theme', opts.theme)
  if (opts.colorMode) el.setAttribute('color-mode', opts.colorMode)
  if (opts.prompt) el.setAttribute('prompt', opts.prompt)
  if (opts.fabIcon) el.setAttribute('fab-icon', opts.fabIcon)

  applyThemeVars(el, opts.themeVars)

  // Resolve the token. Static strings are set immediately; functions are called
  // and the result is set when ready. The Vue prop-watcher inside the element
  // triggers connect once token is non-empty. If no token is provided (public
  // bot), set an empty string so the watcher still fires.
  const setToken = (t: string): void => {
    el.setAttribute('token', t)
  }
  if (opts.token === undefined) {
    setToken('')
  } else if (typeof opts.token === 'function') {
    Promise.resolve(opts.token())
      .then(setToken)
      .catch((err) => opts.onError?.(err instanceof Error ? err : new Error(String(err))))
  } else {
    setToken(opts.token)
  }

  // Mount target. CSS selector or HTMLElement; default = body.
  let parent: HTMLElement
  if (opts.mount instanceof HTMLElement) {
    parent = opts.mount
  } else if (typeof opts.mount === 'string') {
    const found = document.querySelector(opts.mount)
    if (!found) throw new Error(`[bridle] mount target not found: ${opts.mount}`)
    parent = found as HTMLElement
  } else {
    parent = document.body
  }
  parent.appendChild(el)

  injectCustomStyles(el, opts.customCss, opts.stylesheets)

  // Hook UI events to the optional callbacks. Listeners are bound on the
  // element itself — Vue's defineCustomElement re-emits component events as
  // native CustomEvents.
  if (opts.onReady) el.addEventListener('ready', () => opts.onReady?.())
  if (opts.onMessage) {
    el.addEventListener('message', (e) =>
      opts.onMessage?.((e as CustomEvent<IBridleMessage>).detail),
    )
  }
  if (opts.onError) {
    el.addEventListener('error', (e) =>
      opts.onError?.((e as unknown as CustomEvent<Error>).detail),
    )
  }

  return {
    element: el,
    open: () => el.open?.(),
    close: () => el.close?.(),
    sendMessage: (text: string) => el.sendMessage?.(text),
    destroy: () => el.remove(),
  }
}

function autoMount(): void {
  const script = _selfScript ?? findOwnScript()
  if (!script) return
  const ds = script.dataset
  if (!ds.agentId) return
  const apiUrl = ds.apiUrl ?? new URL(script.src).origin
  // `data-stylesheet` may be comma-separated for multiple URLs:
  //   data-stylesheet="/css/a.css, /css/b.css"
  const stylesheets = ds.stylesheet
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  init({
    apiUrl,
    agentId: ds.agentId,
    token: ds.token ?? '',
    mount: ds.mount,
    mode: (ds.mode as 'floating' | 'inline' | undefined) ?? 'floating',
    title: ds.title,
    placeholder: ds.placeholder,
    theme: ds.theme as 'default' | 'cleanslice' | undefined,
    colorMode: ds.colorMode as 'auto' | 'light' | 'dark' | undefined,
    prompt: ds.prompt,
    fabIcon: ds.fabIcon,
    customCss: ds.customCss,
    stylesheets,
  })
}

function bootstrap(): void {
  register()
  try {
    autoMount()
  } catch (err) {
    console.error('[bridle] auto-mount failed:', err)
  }
}

/** Tag name of the registered Custom Element. */
export const tag = ELEMENT_TAG
/** SDK version, replaced at build time from package.json. */
export const version: string = __BRIDLE_VERSION__

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true })
  } else {
    bootstrap()
  }
}

export { init, BridleClient, BridleAuthError }
export type {
  BridlePart,
  IBridleMessage,
  IBridleInitOptions,
  IBridleInstance,
} from './types'
