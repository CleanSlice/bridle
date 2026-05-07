<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { BridleClient } from './client'
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
  }>(),
  {
    title: 'Agent Chat',
    placeholder: 'Type a message...',
    mode: 'floating',
    defaultOpen: false,
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
const isOpen = ref(props.mode === 'inline' || coerceBool(props.defaultOpen))
const draft = ref('')
const scrollEl = ref<HTMLElement | null>(null)

let client: BridleClient | null = null

function coerceBool(v: boolean | string): boolean {
  return v === true || v === 'true' || v === ''
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
  })
}

async function connect(): Promise<void> {
  client?.disconnect()
  client = buildClient()
  client.on('open', () => {
    isConnected.value = true
    emit('ready')
  })
  client.on('close', () => {
    isConnected.value = false
  })
  client.on('error', (err) => {
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

// Reconnect when bot/token/api changes — useful for dynamic dashboards.
// Token may be empty for public bots (auth via Origin whitelist).
watch(
  () => [props.apiUrl, props.agentId, props.token],
  () => {
    if (!props.apiUrl || !props.agentId) return
    messages.value = []
    void connect()
  },
)

onMounted(async () => {
  if (!props.apiUrl || !props.agentId) return
  await connect()
})

onBeforeUnmount(() => {
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
:host {
  --bridle-primary: #0070f3;
  --bridle-primary-fg: #ffffff;
  --bridle-bg: #ffffff;
  --bridle-fg: #111827;
  --bridle-muted: #6b7280;
  --bridle-bubble-bg: #f3f4f6;
  --bridle-border: #e5e7eb;
  --bridle-radius: 14px;
  --bridle-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
  --bridle-z: 2147483600;
  --bridle-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;

  font-family: var(--bridle-font);
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :host {
    --bridle-bg: #0f172a;
    --bridle-fg: #f1f5f9;
    --bridle-muted: #94a3b8;
    --bridle-bubble-bg: #1e293b;
    --bridle-border: #334155;
    color-scheme: dark;
  }
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
  background: var(--bridle-primary);
  color: var(--bridle-primary-fg);
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
}
.bridle__input textarea:focus {
  border-color: var(--bridle-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--bridle-primary) 20%, transparent);
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
