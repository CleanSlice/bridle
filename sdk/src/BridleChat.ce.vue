<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick, useHost } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { BridleClient, BridleAuthError } from './client'
import type {
  BridlePart,
  BridleUiValue,
  IBridleMessage,
  IBridleUiPart,
  IBridleUiSubmitPart,
} from './types'

interface IBridleAttachment {
  id: string
  name: string
  size: number
  mediaType: string
  base64: string
  dataUrl: string
}

// 5 attachments fits comfortably; bigger payloads start to choke the
// default Socket.IO 1 MB buffer even after the downscale pass below.
const MAX_ATTACHMENTS = 5
// Reject the original file outright above this — we still downscale,
// but a 50 MB raw image bricks the browser before the canvas even runs.
const MAX_FILE_SIZE = 10 * 1024 * 1024
// Anything larger gets routed through the downscale pass so the Socket.IO
// payload stays well under the 1 MB default. Smaller files ship as-is —
// no quality loss when we don't need it.
const DOWNSCALE_OVER = 800 * 1024
const MAX_DIMENSION = 1280
const JPEG_QUALITY = 0.85

// One-time DOMPurify hook: route agent-supplied links through a new tab so a
// rogue href never navigates the host page out from under the embed.
let purifyInitialized = false
function initPurify(): void {
  if (purifyInitialized) return
  purifyInitialized = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if ((node as Element).tagName === 'A') {
      const a = node as HTMLAnchorElement
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

const MARKDOWN_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'del', 's', 'code', 'pre',
  'a', 'ul', 'ol', 'li', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]

function renderMarkdown(text: string): string {
  if (!text) return ''
  initPurify()
  const html = marked.parse(text, {
    gfm: true,
    breaks: true,
    async: false,
  }) as string
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: MARKDOWN_ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'title'],
  })
}

const props = withDefaults(
  defineProps<{
    apiUrl: string
    agentId: string
    token: string
    title?: string
    placeholder?: string
    mode?: 'floating' | 'inline'
    /** Open the panel by default (floating mode). Honored once on mount. */
    defaultOpen?: boolean | string
    /** Visual theme. `default` is neutral; `cleanslice` matches the CleanSlice teal palette. */
    theme?: 'default' | 'cleanslice'
    /**
     * Color scheme. `auto` follows the host page (`<html class="dark">` or
     * `prefers-color-scheme`); `light`/`dark` force one regardless.
     */
    colorMode?: 'auto' | 'light' | 'dark'
    /**
     * Integrator-supplied context forwarded with every message (page URL,
     * user plan, etc.). Sent once at handshake.
     */
    prompt?: string
    /**
     * Replace the built-in chat-bubble glyph on the floating FAB with your
     * own image. Accepts any URL the browser can render in `<img>` —
     * `.svg`, `.png`, `.webp`, or a `data:` URI.
     */
    fabIcon?: string
    /**
     * Welcome message shown by the agent the first time the chat is opened
     * on an empty transcript. Rendered as a regular assistant bubble after
     * a brief typing-indicator delay (see `greetingDelay`). Suppressed if
     * the transcript already has messages or the user sends something
     * during the delay. Markdown is supported.
     */
    greeting?: string
    /**
     * Milliseconds to show the typing indicator before the `greeting`
     * message appears. Default: 3000. Set to 0 to skip the delay.
     */
    greetingDelay?: number | string
    /**
     * URL of an avatar image shown on the empty-state screen above the
     * empty-state title. Any `<img>`-renderable source — SVG, PNG, WEBP,
     * or `data:` URI.
     */
    emptyAvatar?: string
    /**
     * Headline shown on the empty-state screen, e.g. "What can I help with?".
     * If unset, the legacy "Start a conversation" copy is used.
     */
    emptyTitle?: string
    /** Sub-line shown under `emptyTitle`. Optional. */
    emptySubtitle?: string
    /**
     * Preset suggestion buttons rendered as chips under the empty-state
     * copy. Clicking one sends it as a regular user message and the
     * empty state disappears.
     *
     * Pass an array via `init({ suggestions: [...] })`. On script tags, pass
     * a pipe-separated string via `data-suggestions="Q1|Q2|Q3"` (or a JSON
     * array string — both are accepted).
     */
    suggestions?: string | string[]
  }>(),
  {
    title: 'Agent Chat',
    placeholder: 'Type a message...',
    mode: 'floating',
    defaultOpen: false,
    theme: 'default',
    colorMode: 'auto',
  },
)

const emit = defineEmits<{
  ready: []
  message: [message: IBridleMessage]
  error: [error: Error]
  open: []
  close: []
}>()

const messages = ref<IBridleMessage[]>([])
const isConnected = ref(false)
const isTyping = ref(false)
const connectionError = ref<BridleAuthError | Error | null>(null)
const isOpen = ref(props.mode === 'inline' || coerceBool(props.defaultOpen))
const draft = ref('')
const attachments = ref<IBridleAttachment[]>([])
const isDraggingFile = ref(false)
const dragCounter = ref(0)
const scrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)
const menuOpen = ref(false)
const menuEl = ref<HTMLElement | null>(null)
// One-shot guard so we don't show the greeting twice (open/close/open) or
// fire while a transcript replay is still racing in from the hub.
const greetingShown = ref(false)
let greetingTimer: ReturnType<typeof setTimeout> | null = null
// Per-uiId form state keyed by the ui part's uiId. Multiple forms in one
// message stay independent. `submitted` flips on send so we can disable
// the form and freeze its values in the transcript.
interface IUiFormState {
  values: Record<string, BridleUiValue>
  submitted: boolean
  error: string | null
}
const uiState = ref<Record<string, IUiFormState>>({})

let client: BridleClient | null = null

const host = useHost()
const resolvedColorMode = ref<'light' | 'dark'>('light')
let mediaQuery: MediaQueryList | null = null
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null
let htmlObserver: MutationObserver | null = null

function coerceBool(v: boolean | string): boolean {
  return v === true || v === 'true' || v === ''
}

function detectHostColorScheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  // VitePress, Tailwind, shadcn-vue, and most stacks toggle a `.dark` class on
  // <html>. Honor that first, then fall back to the OS-level media query.
  if (document.documentElement.classList.contains('dark')) return 'dark'
  if (typeof window !== 'undefined' && window.matchMedia) {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
  }
  return 'light'
}

function applyColorMode(): void {
  resolvedColorMode.value =
    props.colorMode === 'auto' ? detectHostColorScheme() : props.colorMode
  if (host) {
    host.dataset.theme = props.theme
    host.dataset.colorMode = resolvedColorMode.value
  }
}

function bindAutoColorMode(): void {
  unbindAutoColorMode()
  if (props.colorMode !== 'auto' || typeof window === 'undefined') return

  if (window.matchMedia) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaListener = () => applyColorMode()
    // `addEventListener` is the modern API; `addListener` is the Safari < 14 fallback.
    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', mediaListener)
    else mediaQuery.addListener(mediaListener)
  }

  htmlObserver = new MutationObserver(() => applyColorMode())
  htmlObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme'],
  })
}

function unbindAutoColorMode(): void {
  if (mediaQuery && mediaListener) {
    if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', mediaListener)
    else mediaQuery.removeListener(mediaListener)
  }
  mediaQuery = null
  mediaListener = null
  htmlObserver?.disconnect()
  htmlObserver = null
}

function upsert(m: IBridleMessage): void {
  const idx = messages.value.findIndex((x) => x.id === m.id)
  if (idx >= 0) messages.value[idx] = m
  else messages.value.push(m)
}

function buildClient(): BridleClient {
  return new BridleClient({
    apiUrl: props.apiUrl,
    agentId: props.agentId,
    token: props.token,
    prompt: props.prompt,
  })
}

async function connect(): Promise<void> {
  client?.disconnect()
  client = buildClient()
  client.on('open', () => {
    isConnected.value = true
    connectionError.value = null
    emit('ready')
  })
  client.on('close', () => {
    isConnected.value = false
  })
  client.on('error', (err) => {
    connectionError.value = err
    emit('error', err)
  })
  client.on('welcome', ({ clientId }) => {
    // Hub assigns clientId from JWT sub (or 'admin' for admin tokens) and
    // the runtime persists the transcript at `bridle:<clientId>.jsonl`.
    // Replay it so the chat survives a page refresh — live messages keep
    // flowing through the socket while this fetch runs.
    void loadTranscript(clientId)
  })
  client.on('typing', () => {
    isTyping.value = true
  })
  client.on('message', (m) => {
    isTyping.value = false
    upsert(m)
    emit('message', m)
  })
  client.on('stream', (m) => {
    isTyping.value = false
    upsert(m)
  })
  client.on('stream_end', (m) => {
    upsert(m)
    emit('message', m)
  })
  await client.connect()
}

async function loadTranscript(channel: string): Promise<void> {
  if (!channel) return
  try {
    const url =
      `${props.apiUrl.replace(/\/$/, '')}` +
      `/api/agent/${encodeURIComponent(props.agentId)}/transcript` +
      `?channel=${encodeURIComponent(channel)}`
    const headers: Record<string, string> = {}
    if (props.token) headers.Authorization = `Bearer ${props.token}`
    const res = await fetch(url, { headers })
    if (!res.ok) return
    type ApiMessage = {
      id: string
      role: 'user' | 'assistant'
      text: string
      ts: number
    }
    const body = (await res.json()) as
      | { messages?: ApiMessage[]; data?: { messages?: ApiMessage[] } }
      | null
    const items: ApiMessage[] = body?.data?.messages ?? body?.messages ?? []
    if (items.length === 0) return
    // Merge transcript with whatever is already on screen — live wins on
    // id collisions (the agent may have already re-sent a tail message
    // by the time this fetch resolves). Order by `ts` so insertion is
    // visually correct.
    const map = new Map<string, IBridleMessage>()
    for (const m of items) {
      map.set(m.id, {
        id: m.id,
        role: m.role,
        text: m.text,
        parts: [{ type: 'text', text: m.text }],
        ts: m.ts,
      })
    }
    for (const m of messages.value) map.set(m.id, m)
    messages.value = Array.from(map.values()).sort((a, b) => a.ts - b.ts)
  } catch (err) {
    console.warn('[bridle] transcript load failed:', err)
  }
}

function send(): void {
  const text = draft.value.trim()
  if (!client) return
  if (!text && attachments.value.length === 0) return

  // Image parts come first so the agent sees the image before the caption
  // — matches how every chat client orders attached media + accompanying text.
  const parts: BridlePart[] = attachments.value.map((a) => ({
    type: 'image' as const,
    base64: a.base64,
    mediaType: a.mediaType,
  }))
  if (text) parts.push({ type: 'text', text })

  upsert({
    id: randomId(),
    role: 'user',
    text,
    parts,
    ts: Date.now(),
  })
  isTyping.value = true
  client.send(text, parts)
  draft.value = ''
  attachments.value = []
  // autoSize() set an inline height on growth; clearing the value alone
  // leaves the textarea tall and empty. Drop the inline style so it falls
  // back to the rows="1" baseline.
  if (inputEl.value) inputEl.value.style.height = ''
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = (err) => {
      URL.revokeObjectURL(url)
      reject(err)
    }
    img.src = url
  })
}

// Small files (≤ DOWNSCALE_OVER) keep their original encoding so PNGs with
// transparency stay PNGs. Large files get drawn into a canvas, capped at
// MAX_DIMENSION on the longest edge, then re-encoded as JPEG — the only
// reliable way to keep the Socket.IO payload under 1 MB without nuking detail.
async function fileToImagePart(
  file: File,
): Promise<{ base64: string; mediaType: string }> {
  if (file.size <= DOWNSCALE_OVER) {
    const dataUrl = await readAsDataUrl(file)
    return {
      base64: dataUrl.split(',', 2)[1] ?? '',
      mediaType: file.type || 'application/octet-stream',
    }
  }
  const img = await loadImage(file)
  const scale = Math.min(MAX_DIMENSION / img.width, MAX_DIMENSION / img.height, 1)
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.drawImage(img, 0, 0, w, h)
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  return {
    base64: dataUrl.split(',', 2)[1] ?? '',
    mediaType: 'image/jpeg',
  }
}

async function addFiles(files: FileList | File[]): Promise<void> {
  for (const file of Array.from(files)) {
    if (attachments.value.length >= MAX_ATTACHMENTS) break
    if (!file.type.startsWith('image/')) {
      console.warn(`[bridle] skipping non-image attachment: ${file.name} (${file.type})`)
      continue
    }
    if (file.size > MAX_FILE_SIZE) {
      console.warn(`[bridle] attachment too large: ${file.name} (${file.size} bytes)`)
      continue
    }
    try {
      const { base64, mediaType } = await fileToImagePart(file)
      attachments.value.push({
        id: randomId(),
        name: file.name,
        size: file.size,
        mediaType,
        base64,
        dataUrl: `data:${mediaType};base64,${base64}`,
      })
    } catch (err) {
      console.warn(`[bridle] failed to read attachment ${file.name}:`, err)
    }
  }
}

function onFileChange(e: Event): void {
  const input = e.target as HTMLInputElement
  if (input.files && input.files.length) {
    void addFiles(input.files)
    // Reset so picking the same file twice in a row still fires `change`.
    input.value = ''
  }
}

function removeAttachment(id: string): void {
  attachments.value = attachments.value.filter((a) => a.id !== id)
}

function openFilePicker(): void {
  if (attachments.value.length >= MAX_ATTACHMENTS) return
  fileInputEl.value?.click()
}

// Drag overlay lives at the panel level. Counter avoids the classic
// flicker where `dragleave` fires for every child element you pass over.
function dragHasFiles(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
}

function onDragEnter(e: DragEvent): void {
  if (!dragHasFiles(e)) return
  e.preventDefault()
  dragCounter.value++
  isDraggingFile.value = true
}

function onDragOver(e: DragEvent): void {
  if (!dragHasFiles(e)) return
  e.preventDefault()
}

function onDragLeave(e: DragEvent): void {
  if (!dragHasFiles(e)) return
  e.preventDefault()
  dragCounter.value = Math.max(0, dragCounter.value - 1)
  if (dragCounter.value === 0) isDraggingFile.value = false
}

function onDrop(e: DragEvent): void {
  if (!dragHasFiles(e)) return
  e.preventDefault()
  dragCounter.value = 0
  isDraggingFile.value = false
  if (e.dataTransfer?.files.length) {
    void addFiles(e.dataTransfer.files)
  }
}

function onPaste(e: ClipboardEvent): void {
  const items = e.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) files.push(f)
    }
  }
  if (files.length) {
    e.preventDefault()
    void addFiles(files)
  }
}

function imageParts(m: IBridleMessage): Array<{ base64: string; mediaType: string }> {
  return m.parts
    .filter((p): p is { type: 'image'; base64: string; mediaType: string } => p.type === 'image')
    .map((p) => ({ base64: p.base64, mediaType: p.mediaType }))
}

function uiParts(m: IBridleMessage): IBridleUiPart[] {
  return m.parts.filter((p): p is IBridleUiPart => p.type === 'ui')
}

function uiSubmitParts(m: IBridleMessage): IBridleUiSubmitPart[] {
  return m.parts.filter((p): p is IBridleUiSubmitPart => p.type === 'ui_submit')
}

// Initialize per-uiId state from a part's defaults the first time we see it.
// Idempotent: re-renders during streaming don't reset what the user typed.
function ensureUiState(part: IBridleUiPart): IUiFormState {
  const existing = uiState.value[part.uiId]
  if (existing) return existing
  const values: Record<string, BridleUiValue> = {}
  for (const c of part.components) {
    if (c.type === 'heading' || c.type === 'text') continue
    if (c.type === 'checkbox') {
      values[c.name] = !!c.default
    } else if (c.type === 'checkbox-group') {
      values[c.name] = Array.isArray(c.default) ? [...c.default] : []
    } else {
      values[c.name] = typeof c.default === 'string' ? c.default : ''
    }
  }
  const fresh: IUiFormState = { values, submitted: false, error: null }
  uiState.value[part.uiId] = fresh
  return fresh
}

function setUiValue(uiId: string, name: string, value: BridleUiValue): void {
  const state = uiState.value[uiId]
  if (!state || state.submitted) return
  state.values[name] = value
  if (state.error) state.error = null
}

function toggleUiCheckboxGroup(uiId: string, name: string, value: string): void {
  const state = uiState.value[uiId]
  if (!state || state.submitted) return
  const current = (state.values[name] as string[] | undefined) ?? []
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value]
  state.values[name] = next
  if (state.error) state.error = null
}

function submitUiForm(part: IBridleUiPart): void {
  const state = ensureUiState(part)
  if (state.submitted || !client) return
  // Validate required fields. First failure short-circuits with a single
  // human-readable error rendered above the submit button.
  for (const c of part.components) {
    if (c.type === 'heading' || c.type === 'text' || c.type === 'checkbox') continue
    if (!c.required) continue
    const v = state.values[c.name]
    const label = ('label' in c && c.label) || c.name
    if (c.type === 'checkbox-group') {
      if (!Array.isArray(v) || v.length === 0) {
        state.error = `${label} — pick at least one option`
        return
      }
    } else if (typeof v !== 'string' || v.trim() === '') {
      state.error = `${label} is required`
      return
    }
  }
  state.error = null
  state.submitted = true

  const submitPart: IBridleUiSubmitPart = {
    type: 'ui_submit',
    uiId: part.uiId,
    values: { ...state.values },
  }
  // Show the user's submission in the transcript as a regular user turn.
  // Plain-text fallback so transcripts and non-Bridle channels stay readable.
  const summary = summarizeUiValues(part, state.values)
  upsert({
    id: randomId(),
    role: 'user',
    text: summary,
    parts: [submitPart],
    ts: Date.now(),
  })
  isTyping.value = true
  client.send('', [submitPart])
}

function summarizeUiValues(
  part: IBridleUiPart,
  values: Record<string, BridleUiValue>,
): string {
  const parts: string[] = []
  for (const c of part.components) {
    if (c.type === 'heading' || c.type === 'text') continue
    const label = ('label' in c && c.label) || c.name
    const v = values[c.name]
    if (c.type === 'checkbox') {
      parts.push(`${label}: ${v ? 'yes' : 'no'}`)
    } else if (Array.isArray(v)) {
      parts.push(`${label}: ${v.join(', ') || '—'}`)
    } else {
      parts.push(`${label}: ${String(v).trim() || '—'}`)
    }
  }
  return parts.join(' · ')
}

function randomId(): string {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return 'm-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// Accepts either an actual string[] (from programmatic `init()`) or a
// string (from `data-suggestions`). JSON arrays parse first; otherwise we
// fall back to `|`-separated values so authors don't have to JSON-quote
// every chip in an HTML attribute.
const parsedSuggestions = computed<string[]>(() => {
  const raw = props.suggestions
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean)
  const trimmed = String(raw).trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map((s) => String(s).trim()).filter(Boolean)
      }
    } catch (err) {
      console.warn('[bridle] could not parse `suggestions` as JSON, falling back to pipe-split:', err)
    }
  }
  return trimmed.split('|').map((s) => s.trim()).filter(Boolean)
})

// Show the custom empty-state UI when ANY of its slots are provided.
// Otherwise the legacy single-line "Start a conversation" copy renders.
const hasCustomEmpty = computed(
  () =>
    !!props.emptyAvatar ||
    !!props.emptyTitle ||
    !!props.emptySubtitle ||
    parsedSuggestions.value.length > 0,
)

function sendSuggestion(text: string): void {
  if (!isConnected.value) return
  draft.value = text
  send()
}

function cancelGreetingTimer(): void {
  if (greetingTimer) {
    clearTimeout(greetingTimer)
    greetingTimer = null
  }
}

// Triggered by the watcher whenever the panel is open + connected + empty.
// Marks the flag immediately so re-fires (e.g. transcript arriving with
// existing history) don't queue a second one. The actual bubble appears
// after `greetingDelay` ms of typing indicator — and we re-check messages
// after the delay so the user typing something first cancels it.
function maybeShowGreeting(): void {
  if (greetingShown.value) return
  const text = props.greeting?.trim()
  if (!text) return
  if (!isOpen.value || !isConnected.value) return
  if (messages.value.length > 0) {
    // Real transcript already filled the panel — nothing to greet over.
    greetingShown.value = true
    return
  }

  greetingShown.value = true
  isTyping.value = true

  const raw =
    typeof props.greetingDelay === 'string'
      ? Number(props.greetingDelay)
      : props.greetingDelay
  const delay = Number.isFinite(raw) && raw !== undefined ? Math.max(0, raw as number) : 3000

  greetingTimer = setTimeout(() => {
    greetingTimer = null
    isTyping.value = false
    // User snuck a message in during the delay — drop the greeting so we
    // don't shove it above their first turn.
    if (messages.value.length > 0) return
    upsert({
      id: randomId(),
      role: 'assistant',
      text,
      parts: [{ type: 'text', text }],
      ts: Date.now(),
    })
  }, delay)
}

function toggle(): void {
  isOpen.value = !isOpen.value
  emit(isOpen.value ? 'open' : 'close')
}

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value
}

/**
 * Start a fresh conversation: wipe the persisted anon channel, clear the
 * local transcript, and reconnect so the hub mints a brand-new clientId.
 * The old anon channel stays on the hub but this visitor never sees it
 * again — same effect as opening the page from a private window.
 */
async function startNewChat(): Promise<void> {
  menuOpen.value = false
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(`bridle:anon:${props.agentId}`)
    } catch {
      // Storage may be disabled (privacy mode) — proceed anyway. The hub
      // mints an ephemeral id in that case; either way the user gets a
      // fresh channel.
    }
  }
  cancelGreetingTimer()
  messages.value = []
  greetingShown.value = false
  isTyping.value = false
  connectionError.value = null
  if (props.apiUrl && props.agentId) {
    await connect()
  }
}

// Close the dropdown on outside click / Escape. `composedPath()` is the
// only reliable way to see into the shadow DOM from a document-level
// listener; without it, every event reports the host element as target
// and the menu would never close.
function onDocClick(e: MouseEvent): void {
  if (!menuOpen.value) return
  const root = menuEl.value
  if (!root) return
  const path = (e as Event).composedPath?.() ?? []
  if (!path.includes(root)) {
    menuOpen.value = false
  }
}

function onDocKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && menuOpen.value) {
    menuOpen.value = false
  }
}

function autoSize(e: Event): void {
  const t = e.target as HTMLTextAreaElement
  t.style.height = 'auto'
  t.style.height = Math.min(t.scrollHeight, 120) + 'px'
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}

watch(
  [messages, isTyping],
  async () => {
    await nextTick()
    if (scrollEl.value) {
      scrollEl.value.scrollTop = scrollEl.value.scrollHeight
    }
  },
  { deep: true },
)

// Reconnect when bot/token/api/prompt changes — useful for dynamic dashboards.
// Token may be empty for public bots (auth via Origin whitelist).
watch(
  () => [props.apiUrl, props.agentId, props.token, props.prompt],
  () => {
    if (!props.apiUrl || !props.agentId) return
    messages.value = []
    cancelGreetingTimer()
    greetingShown.value = false
    void connect()
  },
)

// Welcome message: fires once when the panel is visible, connected, and
// the transcript is empty. Re-evaluates on each state change so we wait
// for the transcript-replay race to settle before deciding.
watch(
  [isOpen, isConnected, () => messages.value.length],
  () => {
    maybeShowGreeting()
  },
  { immediate: true },
)

watch(
  () => [props.theme, props.colorMode],
  () => {
    applyColorMode()
    bindAutoColorMode()
  },
)

onMounted(async () => {
  applyColorMode()
  bindAutoColorMode()
  if (typeof document !== 'undefined') {
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onDocKeydown)
  }
  if (!props.apiUrl || !props.agentId) return
  await connect()
})

onBeforeUnmount(() => {
  unbindAutoColorMode()
  cancelGreetingTimer()
  if (typeof document !== 'undefined') {
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onDocKeydown)
  }
  client?.disconnect()
  client = null
})

defineExpose({
  open: () => {
    if (!isOpen.value) toggle()
  },
  close: () => {
    if (isOpen.value) toggle()
  },
  sendMessage: (text: string) => {
    draft.value = text
    send()
  },
})
</script>

<template>
  <div :class="['bridle', `bridle--${mode}`, isOpen && 'bridle--open']">
    <button
      v-if="mode === 'floating'"
      class="bridle__fab"
      type="button"
      :aria-label="title"
      :title="title"
      @click="toggle"
    >
      <img
        v-if="fabIcon"
        :src="fabIcon"
        :alt="title"
        class="bridle__fab-icon"
        aria-hidden="true"
      />
      <svg v-else viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <div
      v-show="isOpen"
      class="bridle__panel"
      role="dialog"
      :aria-label="title"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <header class="bridle__header">
        <span class="bridle__title">{{ title }}</span>
        <span
          class="bridle__status"
          :class="isConnected ? 'bridle__status--ok' : 'bridle__status--bad'"
          :title="isConnected ? 'Connected' : 'Disconnected'"
          aria-hidden="true"
        >●</span>
        <div ref="menuEl" class="bridle__menu">
          <button
            type="button"
            class="bridle__menu-trigger"
            aria-label="Chat menu"
            :aria-expanded="menuOpen"
            aria-haspopup="menu"
            @click="toggleMenu"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <circle cx="12" cy="5" r="1.6" fill="currentColor" />
              <circle cx="12" cy="12" r="1.6" fill="currentColor" />
              <circle cx="12" cy="19" r="1.6" fill="currentColor" />
            </svg>
          </button>
          <div
            v-show="menuOpen"
            class="bridle__menu-dropdown"
            role="menu"
          >
            <button
              type="button"
              class="bridle__menu-item"
              role="menuitem"
              @click="startNewChat"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path
                  d="M12 5v14M5 12h14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
              New chat
            </button>
          </div>
        </div>
        <button
          v-if="mode === 'floating'"
          type="button"
          class="bridle__close"
          aria-label="Close"
          @click="toggle"
        >×</button>
      </header>

      <div
        v-if="connectionError"
        class="bridle__banner bridle__banner--error"
        role="alert"
      >
        <template v-if="(connectionError as BridleAuthError).code === 'ORIGIN_NOT_ALLOWED'">
          Origin
          <code>{{ (connectionError as BridleAuthError).details?.origin || 'this page' }}</code>
          isn't whitelisted for this agent. Add it in the agent's allowed origins.
        </template>
        <template v-else-if="(connectionError as BridleAuthError).code === 'MISSING_TOKEN'">
          Authentication required — provide a JWT via <code>data-token</code>.
        </template>
        <template v-else-if="(connectionError as BridleAuthError).code === 'INVALID_TOKEN'">
          The provided token is invalid or expired.
        </template>
        <template v-else-if="(connectionError as BridleAuthError).code === 'MISSING_AGENT_ID'">
          Missing <code>agent-id</code> on the embed script.
        </template>
        <template v-else>
          {{ connectionError.message || 'Connection error' }}
        </template>
      </div>

      <div ref="scrollEl" class="bridle__messages">
        <!--
          Empty state. Hidden as soon as the agent starts replying (isTyping)
          or any message lands, so the suggestion chips disappear cleanly
          once the conversation begins.
        -->
        <div
          v-if="messages.length === 0 && !isTyping"
          class="bridle__empty"
          :class="{ 'bridle__empty--rich': hasCustomEmpty }"
        >
          <template v-if="hasCustomEmpty">
            <img
              v-if="emptyAvatar"
              :src="emptyAvatar"
              :alt="emptyTitle || title"
              class="bridle__empty-avatar"
            />
            <h3 v-if="emptyTitle" class="bridle__empty-title">{{ emptyTitle }}</h3>
            <p v-if="emptySubtitle" class="bridle__empty-subtitle">{{ emptySubtitle }}</p>
            <div
              v-if="parsedSuggestions.length"
              class="bridle__suggestions"
              role="group"
              aria-label="Suggested questions"
            >
              <button
                v-for="(s, i) in parsedSuggestions"
                :key="i"
                type="button"
                class="bridle__suggestion"
                :disabled="!isConnected"
                @click="sendSuggestion(s)"
              >{{ s }}</button>
            </div>
          </template>
          <template v-else>Start a conversation</template>
        </div>
        <div
          v-for="m in messages"
          :key="m.id"
          :class="['bridle__msg', `bridle__msg--${m.role}`]"
        >
          <div
            v-if="m.role === 'assistant'"
            class="bridle__bubble bridle__bubble--md"
          >
            <div
              v-for="(p, i) in imageParts(m)"
              :key="`img-${i}`"
              class="bridle__msg-image"
            >
              <img
                :src="`data:${p.mediaType};base64,${p.base64}`"
                alt=""
                loading="lazy"
              />
            </div>
            <div v-if="m.text" v-html="renderMarkdown(m.text)" />
            <form
              v-for="(p, ui) in uiParts(m)"
              :key="`ui-${p.uiId ?? ui}`"
              class="bridle__ui"
              :class="{ 'bridle__ui--submitted': ensureUiState(p).submitted }"
              @submit.prevent="submitUiForm(p)"
            >
              <template v-for="(c, ci) in p.components" :key="`c-${ci}`">
                <h4 v-if="c.type === 'heading'" class="bridle__ui-heading">{{ c.text }}</h4>
                <p v-else-if="c.type === 'text'" class="bridle__ui-text">{{ c.text }}</p>
                <label
                  v-else-if="c.type === 'input'"
                  class="bridle__ui-field"
                >
                  <span v-if="c.label" class="bridle__ui-label">
                    {{ c.label }}<span v-if="c.required" class="bridle__ui-required">*</span>
                  </span>
                  <input
                    type="text"
                    class="bridle__ui-input"
                    :value="ensureUiState(p).values[c.name]"
                    :placeholder="c.placeholder"
                    :required="c.required"
                    :disabled="ensureUiState(p).submitted"
                    @input="setUiValue(p.uiId, c.name, ($event.target as HTMLInputElement).value)"
                  />
                </label>
                <label
                  v-else-if="c.type === 'textarea'"
                  class="bridle__ui-field"
                >
                  <span v-if="c.label" class="bridle__ui-label">
                    {{ c.label }}<span v-if="c.required" class="bridle__ui-required">*</span>
                  </span>
                  <textarea
                    class="bridle__ui-textarea"
                    rows="3"
                    :value="ensureUiState(p).values[c.name]"
                    :placeholder="c.placeholder"
                    :required="c.required"
                    :disabled="ensureUiState(p).submitted"
                    @input="setUiValue(p.uiId, c.name, ($event.target as HTMLTextAreaElement).value)"
                  />
                </label>
                <fieldset
                  v-else-if="c.type === 'radio'"
                  class="bridle__ui-field bridle__ui-fieldset"
                  :disabled="ensureUiState(p).submitted"
                >
                  <legend v-if="c.label" class="bridle__ui-label">
                    {{ c.label }}<span v-if="c.required" class="bridle__ui-required">*</span>
                  </legend>
                  <label
                    v-for="opt in c.options"
                    :key="opt.value"
                    class="bridle__ui-choice"
                  >
                    <input
                      type="radio"
                      :name="`${p.uiId}-${c.name}`"
                      :value="opt.value"
                      :checked="ensureUiState(p).values[c.name] === opt.value"
                      :required="c.required"
                      :disabled="ensureUiState(p).submitted"
                      @change="setUiValue(p.uiId, c.name, opt.value)"
                    />
                    <span>{{ opt.label }}</span>
                  </label>
                </fieldset>
                <label
                  v-else-if="c.type === 'checkbox'"
                  class="bridle__ui-choice"
                >
                  <input
                    type="checkbox"
                    :checked="!!ensureUiState(p).values[c.name]"
                    :disabled="ensureUiState(p).submitted"
                    @change="setUiValue(p.uiId, c.name, ($event.target as HTMLInputElement).checked)"
                  />
                  <span>{{ c.label }}</span>
                </label>
                <fieldset
                  v-else-if="c.type === 'checkbox-group'"
                  class="bridle__ui-field bridle__ui-fieldset"
                  :disabled="ensureUiState(p).submitted"
                >
                  <legend v-if="c.label" class="bridle__ui-label">
                    {{ c.label }}<span v-if="c.required" class="bridle__ui-required">*</span>
                  </legend>
                  <label
                    v-for="opt in c.options"
                    :key="opt.value"
                    class="bridle__ui-choice"
                  >
                    <input
                      type="checkbox"
                      :value="opt.value"
                      :checked="((ensureUiState(p).values[c.name] as string[] | undefined) ?? []).includes(opt.value)"
                      :disabled="ensureUiState(p).submitted"
                      @change="toggleUiCheckboxGroup(p.uiId, c.name, opt.value)"
                    />
                    <span>{{ opt.label }}</span>
                  </label>
                </fieldset>
                <label
                  v-else-if="c.type === 'select'"
                  class="bridle__ui-field"
                >
                  <span v-if="c.label" class="bridle__ui-label">
                    {{ c.label }}<span v-if="c.required" class="bridle__ui-required">*</span>
                  </span>
                  <select
                    class="bridle__ui-select"
                    :value="ensureUiState(p).values[c.name]"
                    :required="c.required"
                    :disabled="ensureUiState(p).submitted"
                    @change="setUiValue(p.uiId, c.name, ($event.target as HTMLSelectElement).value)"
                  >
                    <option v-if="c.placeholder" value="" disabled>{{ c.placeholder }}</option>
                    <option
                      v-for="opt in c.options"
                      :key="opt.value"
                      :value="opt.value"
                    >{{ opt.label }}</option>
                  </select>
                </label>
              </template>
              <p
                v-if="ensureUiState(p).error"
                class="bridle__ui-error"
                role="alert"
              >{{ ensureUiState(p).error }}</p>
              <button
                type="submit"
                class="bridle__ui-submit"
                :disabled="!isConnected || ensureUiState(p).submitted"
              >{{ ensureUiState(p).submitted ? 'Sent' : (p.submit?.label ?? 'Apply') }}</button>
            </form>
          </div>
          <div v-else class="bridle__bubble">
            <div
              v-for="(p, i) in imageParts(m)"
              :key="`img-${i}`"
              class="bridle__msg-image"
            >
              <img
                :src="`data:${p.mediaType};base64,${p.base64}`"
                alt=""
                loading="lazy"
              />
            </div>
            <div
              v-for="(p, i) in uiSubmitParts(m)"
              :key="`sub-${i}`"
              class="bridle__ui-summary"
            >
              <span class="bridle__ui-summary-label">Submitted</span>
              <span class="bridle__ui-summary-values">{{ m.text || '—' }}</span>
            </div>
            <span v-if="m.text && uiSubmitParts(m).length === 0" class="bridle__msg-text">{{ m.text }}</span>
          </div>
        </div>
        <div v-if="isTyping" class="bridle__typing" aria-label="Agent is typing">
          <span /><span /><span />
        </div>
      </div>

      <div
        v-show="isDraggingFile"
        class="bridle__drop-overlay"
        aria-hidden="true"
      >
        <div class="bridle__drop-hint">Drop image to attach</div>
      </div>

      <div v-if="attachments.length" class="bridle__attachments">
        <div
          v-for="a in attachments"
          :key="a.id"
          class="bridle__attachment"
        >
          <img :src="a.dataUrl" :alt="a.name" class="bridle__attachment-img" />
          <button
            type="button"
            class="bridle__attachment-remove"
            aria-label="Remove attachment"
            @click="removeAttachment(a.id)"
          >×</button>
        </div>
      </div>

      <form class="bridle__input" @submit.prevent="send">
        <input
          ref="fileInputEl"
          type="file"
          accept="image/*"
          multiple
          class="bridle__file-input"
          @change="onFileChange"
        />
        <button
          type="button"
          class="bridle__attach"
          aria-label="Attach image"
          :disabled="!isConnected || attachments.length >= MAX_ATTACHMENTS"
          @click="openFilePicker"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <textarea
          ref="inputEl"
          v-model="draft"
          :placeholder="placeholder"
          :disabled="!isConnected"
          rows="1"
          @input="autoSize"
          @keydown="onKeydown"
          @paste="onPaste"
        />
        <button
          type="submit"
          :disabled="!isConnected || (!draft.trim() && attachments.length === 0)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M5 12h14M13 6l6 6-6 6"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </form>
    </div>
  </div>
</template>

<style>
/* ---- Base / shared tokens ---- */
:host {
  --bridle-radius: 14px;
  --bridle-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
  --bridle-z: 2147483600;
  --bridle-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;

  font-family: var(--bridle-font);
}

/* ---- Default theme — neutral light ---- */
:host,
:host([data-theme="default"]) {
  --bridle-primary: #0070f3;
  --bridle-primary-fg: #ffffff;
  --bridle-bg: #ffffff;
  --bridle-bg-elv: #ffffff;
  --bridle-fg: #111827;
  --bridle-muted: #6b7280;
  --bridle-bubble-bg: #f3f4f6;
  --bridle-user-bg: var(--bridle-primary);
  --bridle-user-fg: var(--bridle-primary-fg);
  --bridle-border: #e5e7eb;
  --bridle-focus-ring: color-mix(in srgb, var(--bridle-primary) 20%, transparent);
  --bridle-error-bg: #fee2e2;
  --bridle-error-fg: #991b1b;
  --bridle-error-border: #fca5a5;
  color-scheme: light;
}

/* ---- Default theme — neutral dark ---- */
:host([data-color-mode="dark"]),
:host([data-theme="default"][data-color-mode="dark"]) {
  --bridle-bg: #0f172a;
  --bridle-bg-elv: #0b1220;
  --bridle-fg: #f1f5f9;
  --bridle-muted: #94a3b8;
  --bridle-bubble-bg: #1e293b;
  --bridle-border: #334155;
  --bridle-error-bg: rgba(248, 113, 113, 0.14);
  --bridle-error-fg: #fecaca;
  --bridle-error-border: rgba(248, 113, 113, 0.32);
  color-scheme: dark;
}

/* ---- CleanSlice theme — teal/cyan light ---- */
:host([data-theme="cleanslice"]) {
  --bridle-primary: #4A95B0;
  --bridle-primary-fg: #ffffff;
  --bridle-bg: #ffffff;
  --bridle-bg-elv: #F2F6FA;
  --bridle-fg: #3C4A57;
  --bridle-muted: #6E8796;
  --bridle-bubble-bg: #DDE6ED;
  --bridle-user-bg: #4A95B0;
  --bridle-user-fg: #ffffff;
  --bridle-border: #C8D5DF;
  --bridle-focus-ring: rgba(74, 149, 176, 0.22);
  --bridle-shadow: 0 12px 32px rgba(0, 140, 160, 0.18), 0 0 24px rgba(0, 150, 170, 0.08);
  color-scheme: light;
}

/* ---- CleanSlice theme — teal/cyan dark ----
   Refinements vs. v0.4.0:
   - User bubble uses a deeper teal (--bridle-user-bg) instead of full primary,
     so messages don't feel like neon stamps on a dark canvas.
   - Input strip sits on --bridle-bg-elv (slightly darker than the message
     area) to create a clear vertical hierarchy.
   - Shadow is heavier-black, lighter-cyan: keeps depth without the foggy halo.
   - Focus ring uses an inner glow at lower opacity. */
:host([data-theme="cleanslice"][data-color-mode="dark"]) {
  --bridle-primary: #5CC6D6;
  --bridle-primary-fg: #0F1C24;
  --bridle-bg: #1A2B36;
  --bridle-bg-elv: #132531;
  --bridle-fg: #D9E4EC;
  --bridle-muted: #8FA8B6;
  --bridle-bubble-bg: #213642;
  --bridle-user-bg: #2D5965;
  --bridle-user-fg: #E8F5F8;
  --bridle-border: #27414F;
  --bridle-focus-ring: rgba(92, 198, 214, 0.28);
  --bridle-shadow: 0 16px 40px rgba(0, 0, 0, 0.55), 0 0 18px rgba(92, 198, 214, 0.10);
  color-scheme: dark;
}

.bridle--floating {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: var(--bridle-z);
}

/* Custom elements default to `display: inline`, which gives the host no
   definite height — so the inline panel's `height: 100%` would resolve
   against auto and grow with the transcript, stretching the host page.
   Make the inline host a block that fills its (fixed-height) container so
   the 100% chain below has something concrete to resolve against. Scoped to
   inline only; floating relies on position:fixed/absolute and must NOT take
   block height in the page flow. */
:host([mode="inline"]) {
  display: block;
  height: 100%;
}

.bridle--inline {
  display: block;
  width: 100%;
  height: 100%;
}

.bridle__fab {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 0;
  background: var(--bridle-primary);
  color: var(--bridle-primary-fg);
  cursor: pointer;
  box-shadow: var(--bridle-shadow);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s ease;
}
.bridle__fab:hover { transform: scale(1.05); }
.bridle__fab:active { transform: scale(0.96); }
.bridle__fab-icon {
  width: 24px;
  height: 24px;
  object-fit: contain;
  display: block;
  pointer-events: none;
}

.bridle__panel {
  position: absolute;
  bottom: 72px;
  right: 0;
  width: 380px;
  max-width: calc(100vw - 32px);
  height: 560px;
  max-height: calc(100vh - 100px);
  background: var(--bridle-bg);
  color: var(--bridle-fg);
  border: 1px solid var(--bridle-border);
  border-radius: var(--bridle-radius);
  box-shadow: var(--bridle-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.bridle--inline .bridle__panel {
  position: relative;
  bottom: auto;
  right: auto;
  width: 100%;
  height: 100%;
  min-height: 480px;
  max-height: none;
}

/* On narrow viewports the 380×560 panel feels cramped, especially with the
   keyboard up. Switch it to fixed-position near-fullscreen — pinned 8px from
   each side, leaving 88px at the bottom for the FAB to stay tappable. */
@media (max-width: 480px) {
  .bridle--floating .bridle__panel {
    position: fixed;
    inset: 8px 8px 88px 8px;
    width: auto;
    max-width: none;
    height: auto;
    max-height: none;
  }
}

.bridle__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--bridle-border);
  background: var(--bridle-bg-elv);
  font-weight: 600;
  font-size: 14px;
  flex-shrink: 0;
}
.bridle__title { flex: 1; }
.bridle__status { font-size: 10px; line-height: 1; }
.bridle__status--ok { color: #16a34a; }
.bridle__status--bad { color: #dc2626; }

.bridle__close {
  background: transparent;
  border: 0;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  color: var(--bridle-muted);
  padding: 0 4px;
  border-radius: 4px;
}
.bridle__close:hover { background: var(--bridle-bubble-bg); }

/* ---- Header overflow menu (3-dot) ---- */
.bridle__menu {
  position: relative;
  flex-shrink: 0;
}
.bridle__menu-trigger {
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--bridle-muted);
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}
.bridle__menu-trigger:hover {
  background: var(--bridle-bubble-bg);
  color: var(--bridle-fg);
}
.bridle__menu-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 140px;
  padding: 4px;
  background: var(--bridle-bg);
  border: 1px solid var(--bridle-border);
  border-radius: 8px;
  box-shadow: var(--bridle-shadow);
  display: flex;
  flex-direction: column;
  z-index: 10;
}
.bridle__menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 8px 10px;
  font-family: inherit;
  font-size: 13px;
  color: var(--bridle-fg);
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease;
}
.bridle__menu-item:hover {
  background: var(--bridle-bubble-bg);
}
.bridle__menu-item svg {
  color: var(--bridle-muted);
  flex-shrink: 0;
}

.bridle__banner {
  font-size: 12px;
  line-height: 1.4;
  padding: 8px 16px;
  border-bottom: 1px solid var(--bridle-border);
  flex-shrink: 0;
}
.bridle__banner--error {
  background: var(--bridle-error-bg);
  color: var(--bridle-error-fg);
  border-bottom-color: var(--bridle-error-border);
}
.bridle__banner code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

.bridle__messages {
  flex: 1;
  /* Flex items default to min-height:auto (= content height), which keeps a
     long transcript from shrinking and makes the column grow instead of
     scrolling. min-height:0 lets this region shrink so overflow-y:auto wins. */
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bridle__empty {
  text-align: center;
  color: var(--bridle-muted);
  font-size: 13px;
  margin-top: 40px;
}

/* Rich empty-state: avatar + title + subtitle + suggestion chips. */
.bridle__empty--rich {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 24px;
  padding: 0 8px;
}
.bridle__empty-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--bridle-bubble-bg);
  border: 1px solid var(--bridle-border);
}
.bridle__empty-title {
  margin: 4px 0 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--bridle-fg);
  line-height: 1.3;
}
.bridle__empty-subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--bridle-muted);
  line-height: 1.4;
  max-width: 280px;
}
.bridle__suggestions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin-top: 12px;
}
.bridle__suggestion {
  appearance: none;
  background: var(--bridle-bg);
  color: var(--bridle-fg);
  border: 1px solid var(--bridle-border);
  border-radius: 999px;
  padding: 6px 12px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.3;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
  max-width: 100%;
  white-space: normal;
  text-align: center;
}
.bridle__suggestion:not(:disabled):hover {
  border-color: var(--bridle-primary);
  color: var(--bridle-primary);
}
.bridle__suggestion:not(:disabled):focus-visible {
  outline: none;
  border-color: var(--bridle-primary);
  box-shadow: 0 0 0 3px var(--bridle-focus-ring);
}
.bridle__suggestion:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bridle__msg { display: flex; }
.bridle__msg--user { justify-content: flex-end; }
.bridle__msg--assistant { justify-content: flex-start; }

.bridle__bubble {
  max-width: 80%;
  padding: 8px 12px;
  border-radius: 14px;
  background: var(--bridle-bubble-bg);
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
/* Markdown-rendered bubbles use HTML elements for layout — disable pre-wrap
   so newlines from <br> don't double up. word-break stays for long URLs. */
.bridle__bubble--md {
  white-space: normal;
}
.bridle__msg--user .bridle__bubble {
  background: var(--bridle-user-bg);
  color: var(--bridle-user-fg);
  border-bottom-right-radius: 4px;
}
.bridle__msg--assistant .bridle__bubble {
  border-bottom-left-radius: 4px;
}

/* ---- Markdown typography (assistant bubbles) ----
   :where() keeps specificity at 0 so theme overrides don't have to fight. */
.bridle__bubble--md :where(p) {
  margin: 0;
}
.bridle__bubble--md :where(p + p),
.bridle__bubble--md :where(p + ul),
.bridle__bubble--md :where(p + ol),
.bridle__bubble--md :where(ul + p),
.bridle__bubble--md :where(ol + p),
.bridle__bubble--md :where(p + pre),
.bridle__bubble--md :where(pre + p),
.bridle__bubble--md :where(p + blockquote),
.bridle__bubble--md :where(blockquote + p),
.bridle__bubble--md :where(p + h1),
.bridle__bubble--md :where(p + h2),
.bridle__bubble--md :where(p + h3) {
  margin-top: 8px;
}
.bridle__bubble--md :where(strong) { font-weight: 600; }
.bridle__bubble--md :where(em) { font-style: italic; }
.bridle__bubble--md :where(del, s) { text-decoration: line-through; }
.bridle__bubble--md :where(a) {
  color: var(--bridle-primary);
  text-decoration: underline;
  word-break: break-word;
}
.bridle__bubble--md :where(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.92em;
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 5px;
  border-radius: 4px;
  word-break: break-word;
}
.bridle__bubble--md :where(pre) {
  margin: 8px 0 0;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 8px;
  overflow-x: auto;
  font-size: 0.92em;
  line-height: 1.4;
}
.bridle__bubble--md :where(pre code) {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
}
.bridle__bubble--md :where(ul, ol) {
  margin: 4px 0 0;
  padding-left: 22px;
}
.bridle__bubble--md :where(li) {
  margin: 2px 0;
}
.bridle__bubble--md :where(blockquote) {
  margin: 6px 0;
  padding-left: 10px;
  border-left: 3px solid var(--bridle-border);
  color: var(--bridle-muted);
}
.bridle__bubble--md :where(h1, h2, h3, h4, h5, h6) {
  margin: 8px 0 4px;
  font-weight: 600;
  line-height: 1.3;
}
.bridle__bubble--md :where(h1) { font-size: 1.15em; }
.bridle__bubble--md :where(h2) { font-size: 1.10em; }
.bridle__bubble--md :where(h3) { font-size: 1.05em; }
.bridle__bubble--md :where(h4, h5, h6) { font-size: 1em; }
.bridle__bubble--md :where(hr) {
  margin: 10px 0;
  border: 0;
  border-top: 1px solid var(--bridle-border);
}
.bridle__bubble--md :where(table) {
  border-collapse: collapse;
  margin: 6px 0;
  font-size: 0.95em;
}
.bridle__bubble--md :where(th, td) {
  border: 1px solid var(--bridle-border);
  padding: 4px 8px;
}
/* In dark mode, the rgba(0,0,0,…) backgrounds for code disappear into the
   dark bubble. Brighten them so code blocks stay distinguishable. */
:host([data-color-mode="dark"]) .bridle__bubble--md :where(code),
:host([data-color-mode="dark"]) .bridle__bubble--md :where(pre) {
  background: rgba(255, 255, 255, 0.08);
}

.bridle__typing {
  align-self: flex-start;
  display: inline-flex;
  gap: 4px;
  padding: 10px 14px;
  background: var(--bridle-bubble-bg);
  border-radius: 14px;
  border-bottom-left-radius: 4px;
}
.bridle__typing span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--bridle-muted);
  animation: bridle-bounce 1.4s infinite ease-in-out;
}
.bridle__typing span:nth-child(2) { animation-delay: 0.15s; }
.bridle__typing span:nth-child(3) { animation-delay: 0.3s; }

@keyframes bridle-bounce {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}

.bridle__input {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--bridle-border);
  background: var(--bridle-bg-elv);
  align-items: flex-end;
  flex-shrink: 0;
}

.bridle__input textarea {
  flex: 1;
  resize: none;
  box-sizing: border-box;
  border: 1px solid var(--bridle-border);
  border-radius: 10px;
  padding: 7px 12px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.4;
  background: var(--bridle-bg);
  color: var(--bridle-fg);
  outline: none;
  min-height: 36px;
  max-height: 120px;
  overflow-y: auto;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.bridle__input textarea::placeholder { color: var(--bridle-muted); }
.bridle__input textarea:focus {
  border-color: var(--bridle-primary);
  box-shadow: 0 0 0 3px var(--bridle-focus-ring);
}
.bridle__input textarea:disabled { opacity: 0.6; cursor: not-allowed; }

.bridle__input button[type="submit"] {
  flex-shrink: 0;
  background: var(--bridle-primary);
  color: var(--bridle-primary-fg);
  border: 0;
  border-radius: 10px;
  width: 36px;
  height: 36px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s ease;
}
.bridle__input button[type="submit"]:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.bridle__input button[type="submit"]:not(:disabled):hover { opacity: 0.9; }

/* ---- Attachments ---- */
.bridle__file-input {
  display: none;
}

.bridle__attach {
  background: transparent;
  color: var(--bridle-muted);
  border: 1px solid var(--bridle-border);
  border-radius: 10px;
  width: 36px;
  height: 36px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.bridle__attach:not(:disabled):hover {
  color: var(--bridle-primary);
  border-color: var(--bridle-primary);
}
.bridle__attach:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.bridle__attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px 0;
  background: var(--bridle-bg-elv);
  border-top: 1px solid var(--bridle-border);
  flex-shrink: 0;
}

/* When the attachment strip is visible it already provides the divider
   above the input area — drop the form's own border-top so the two
   1px lines don't stack into a double rule. */
.bridle__attachments + .bridle__input {
  border-top: 0;
}

.bridle__attachment {
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--bridle-border);
  background: var(--bridle-bg);
}

.bridle__attachment-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.bridle__attachment-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  border: 0;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bridle__attachment-remove:hover {
  background: rgba(0, 0, 0, 0.85);
}

/* ---- Drag-over overlay ---- */
.bridle__drop-overlay {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bridle-primary) 14%, var(--bridle-bg));
  border: 2px dashed var(--bridle-primary);
  border-radius: var(--bridle-radius);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
  pointer-events: none;
}
.bridle__drop-hint {
  font-size: 14px;
  font-weight: 600;
  color: var(--bridle-primary);
}

/* ---- Image parts inside message bubbles ---- */
.bridle__msg-image {
  margin-bottom: 6px;
  border-radius: 10px;
  overflow: hidden;
  max-width: 240px;
  background: rgba(0, 0, 0, 0.04);
}
.bridle__msg-image:last-child {
  margin-bottom: 0;
}
.bridle__msg-image img {
  display: block;
  width: 100%;
  height: auto;
}
.bridle__msg-text {
  display: block;
  margin-top: 6px;
}
.bridle__msg-text:first-child {
  margin-top: 0;
}

/* ---- Interactive UI form parts ---- */
.bridle__ui {
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--bridle-border);
  border-radius: 10px;
  background: var(--bridle-bg-elv);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.bridle__ui:first-child { margin-top: 0; }
.bridle__ui--submitted { opacity: 0.7; }

.bridle__ui-heading {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--bridle-fg);
  line-height: 1.3;
}
.bridle__ui-text {
  margin: 0;
  font-size: 13px;
  color: var(--bridle-muted);
  line-height: 1.4;
}

.bridle__ui-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: var(--bridle-fg);
}
.bridle__ui-fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  gap: 6px;
}
.bridle__ui-label {
  font-weight: 500;
}
.bridle__ui-required {
  color: var(--bridle-error-fg, #dc2626);
  margin-left: 2px;
}

.bridle__ui-input,
.bridle__ui-textarea,
.bridle__ui-select {
  font-family: inherit;
  font-size: 13px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--bridle-border);
  background: var(--bridle-bg);
  color: var(--bridle-fg);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.bridle__ui-textarea { resize: vertical; min-height: 56px; }
.bridle__ui-input:focus,
.bridle__ui-textarea:focus,
.bridle__ui-select:focus {
  border-color: var(--bridle-primary);
  box-shadow: 0 0 0 3px var(--bridle-focus-ring);
}

.bridle__ui-choice {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-weight: 400;
}
.bridle__ui-choice input {
  margin: 0;
  cursor: pointer;
  accent-color: var(--bridle-primary);
}
.bridle__ui-fieldset:disabled .bridle__ui-choice,
.bridle__ui-choice input:disabled {
  cursor: not-allowed;
}

.bridle__ui-error {
  margin: 0;
  font-size: 12px;
  color: var(--bridle-error-fg, #dc2626);
}

.bridle__ui-submit {
  align-self: flex-start;
  background: var(--bridle-primary);
  color: var(--bridle-primary-fg);
  border: 0;
  border-radius: 8px;
  padding: 8px 16px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.bridle__ui-submit:not(:disabled):hover { opacity: 0.9; }
.bridle__ui-submit:disabled { opacity: 0.5; cursor: not-allowed; }

/* User-side summary bubble for a sent ui_submit. Keeps the visitor's
   choice visible in the transcript without dumping raw JSON. */
.bridle__ui-summary {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}
.bridle__ui-summary-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.75;
}
.bridle__ui-summary-values {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
