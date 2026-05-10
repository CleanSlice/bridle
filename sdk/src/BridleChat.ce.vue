<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick, useHost } from 'vue'
import { BridleClient, BridleAuthError } from './client'
import type { IBridleMessage } from './types'

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
const scrollEl = ref<HTMLElement | null>(null)

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

function send(): void {
  const text = draft.value.trim()
  if (!text || !client) return
  upsert({
    id: randomId(),
    role: 'user',
    text,
    parts: [{ type: 'text', text }],
    ts: Date.now(),
  })
  isTyping.value = true
  client.send(text)
  draft.value = ''
}

function randomId(): string {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return 'm-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function toggle(): void {
  isOpen.value = !isOpen.value
  emit(isOpen.value ? 'open' : 'close')
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
    void connect()
  },
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
  if (!props.apiUrl || !props.agentId) return
  await connect()
})

onBeforeUnmount(() => {
  unbindAutoColorMode()
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
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
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

    <div v-show="isOpen" class="bridle__panel" role="dialog" :aria-label="title">
      <header class="bridle__header">
        <span class="bridle__title">{{ title }}</span>
        <span
          class="bridle__status"
          :class="isConnected ? 'bridle__status--ok' : 'bridle__status--bad'"
          :title="isConnected ? 'Connected' : 'Disconnected'"
          aria-hidden="true"
        >●</span>
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
        <div v-if="messages.length === 0" class="bridle__empty">
          Start a conversation
        </div>
        <div
          v-for="m in messages"
          :key="m.id"
          :class="['bridle__msg', `bridle__msg--${m.role}`]"
        >
          <div class="bridle__bubble">{{ m.text }}</div>
        </div>
        <div v-if="isTyping" class="bridle__typing" aria-label="Agent is typing">
          <span /><span /><span />
        </div>
      </div>

      <form class="bridle__input" @submit.prevent="send">
        <textarea
          v-model="draft"
          :placeholder="placeholder"
          :disabled="!isConnected"
          rows="1"
          @input="autoSize"
          @keydown="onKeydown"
        />
        <button type="submit" :disabled="!isConnected || !draft.trim()">
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
.bridle__msg--user .bridle__bubble {
  background: var(--bridle-user-bg);
  color: var(--bridle-user-fg);
  border-bottom-right-radius: 4px;
}
.bridle__msg--assistant .bridle__bubble {
  border-bottom-left-radius: 4px;
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
  border: 1px solid var(--bridle-border);
  border-radius: 10px;
  padding: 8px 12px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.4;
  background: var(--bridle-bg);
  color: var(--bridle-fg);
  outline: none;
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

.bridle__input button {
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
.bridle__input button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.bridle__input button:not(:disabled):hover { opacity: 0.9; }
</style>
