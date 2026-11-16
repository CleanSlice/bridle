<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted, type HTMLAttributes } from 'vue'
import { storeToRefs } from 'pinia'
import { useBridleStore } from '../../stores/bridle'
import Message from './Message.vue'
import Input from './Input.vue'
import Thinking from './Thinking.vue'
import { Card, CardContent, CardFooter, CardHeader } from '#theme/components/ui/card'
import { ScrollArea } from '#theme/components/ui/scroll-area'
import { Button } from '#theme/components/ui/button'
import { Bot, Circle, Clock, Loader2, MessageSquarePlus } from 'lucide-vue-next'
import { cn } from '#theme/utils/cn'

const props = withDefaults(defineProps<{
  apiUrl: string
  agentId: string
  token: string
  title?: string
  placeholder?: string
  class?: HTMLAttributes['class']
  showStatus?: boolean
  channel?: string
  showNewChatButton?: boolean
  resetConfirmText?: string
  /**
   * Caption of the collapsed work-log row — the block holding the agent's
   * reasoning for a turn. Default: "Work log".
   */
  thinkingLabel?: string
  /** First line of the notice shown while the agent's request limit is full. */
  limitLabel?: string
  /**
   * Second line of that notice; `{time}` becomes the countdown, or the time
   * of day for a wait of an hour or more.
   */
  limitRetryLabel?: string
}>(), {
  title: 'Agent Chat',
  placeholder: 'Type a message...',
  showStatus: true,
  channel: 'admin',
  showNewChatButton: true,
  thinkingLabel: 'Work log',
  limitLabel: 'This agent has reached its message limit.',
  limitRetryLabel: 'Try again in {time}.',
  resetConfirmText:
    'Delete the saved transcript and start fresh? Past messages will be removed from storage. The agent\'s in-memory context may persist until its next restart.',
})

const store = useBridleStore()
const { messages, isConnected, isTyping, connectionError, isLimited, limitRemainingMs, returnedDraft } = storeToRefs(store)

// ── Request limit ─────────────────────────────────────────────
// The agent's request limit is full: a line above the composer says when to
// try again, Send is off, the field stays editable. The store holds the
// deadline; this only words it. Under an hour it is a running `m:ss`, from an
// hour up the local time of day.
const LIMIT_NOTICE_ID = 'bridle-limit-notice'
const HOUR_MS = 60 * 60 * 1000

const limitRetryText = computed(() => {
  const left = limitRemainingMs.value
  let time: string
  if (left < HOUR_MS) {
    const seconds = Math.max(0, Math.ceil(left / 1000))
    time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  } else {
    time = new Date(Date.now() + left).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return props.limitRetryLabel.replace('{time}', time)
})

const inputRef = ref<InstanceType<typeof Input> | null>(null)

// A message the hub refused for the limit comes back to the composer: the
// store has already taken its bubble out of the conversation.
watch(returnedDraft, (draft) => {
  if (!draft) return
  inputRef.value?.restore(draft.text)
  store.returnedDraft = null
})

// Background tabs throttle timers; the moment the tab is looked at again the
// remaining wait is read off the deadline.
function onVisibilityChange() {
  if (document.visibilityState !== 'hidden') store.tickLimit()
}

// What the error banner actually renders. The hub often rejects the very
// first handshake (auth token lags a beat behind mount), then the automatic
// reconnect succeeds — a raw `connectionError` would flash the red banner
// for ~1s on every load. Only surface an error still standing after
// ERROR_SETTLE_MS; until then the header shows a spinner instead of the red
// dot. Must stay BELOW the socket's reconnectionDelay (2000ms) or each
// retry's fresh error would reset the timer and a genuine failure would
// never surface.
const ERROR_SETTLE_MS = 1500
const displayedError = ref<typeof connectionError.value>(null)
let errorSettleTimer: ReturnType<typeof setTimeout> | null = null

watch(connectionError, (err) => {
  if (errorSettleTimer) {
    clearTimeout(errorSettleTimer)
    errorSettleTimer = null
  }
  if (!err) {
    displayedError.value = null
    return
  }
  errorSettleTimer = setTimeout(() => {
    errorSettleTimer = null
    displayedError.value = connectionError.value
  }, ERROR_SETTLE_MS)
})

const scrollRef = ref<InstanceType<typeof ScrollArea> | null>(null)

watch([messages, isTyping], async () => {
  await nextTick()
  const el = scrollRef.value?.$el?.querySelector('[data-radix-scroll-area-viewport]')
  if (el) el.scrollTop = el.scrollHeight
}, { deep: true })

onMounted(async () => {
  // Replay persisted history first so the chat isn't blank between
  // page refreshes / agent switches; then connect the WS for live updates.
  // Clear before load so the previous bot's messages don't briefly leak
  // through (the store is a shared singleton across providers).
  store.clearMessages()
  await store.loadTranscript(props.apiUrl, props.agentId, props.token, props.channel)
  store.connect(props.apiUrl, props.agentId, props.token)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (errorSettleTimer) {
    clearTimeout(errorSettleTimer)
    errorSettleTimer = null
  }
  store.disconnect()
})

const handleSend = (text: string) => {
  store.sendMessage(text)
}

const resetting = ref(false)

async function onNewChat() {
  if (resetting.value) return
  // Native confirm — bridle is a library, we don't ship a confirm-dialog
  // component. Consumers that want a styled dialog can either fork this
  // template or wrap the store's resetTranscript() with their own UI.
  if (!window.confirm(props.resetConfirmText)) return
  resetting.value = true
  try {
    store.disconnect()
    await store.resetTranscript(props.apiUrl, props.agentId, props.token, props.channel)
    store.connect(props.apiUrl, props.agentId, props.token)
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <Card :class="cn('flex flex-col h-[600px] w-full max-w-2xl', props.class)">
    <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-3 border-b">
      <div class="flex items-center gap-2">
        <Bot class="h-5 w-5" />
        <h3 class="font-semibold text-sm">{{ title }}</h3>
      </div>
      <div class="flex items-center gap-3">
        <Button
          v-if="showNewChatButton"
          variant="ghost"
          size="sm"
          class="h-7 px-2 text-xs"
          :disabled="resetting || messages.length === 0"
          :title="messages.length === 0 ? 'Already empty' : 'Start a new chat'"
          @click="onNewChat"
        >
          <MessageSquarePlus class="h-3.5 w-3.5" />
          New chat
        </Button>
        <div v-if="showStatus" class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <template v-if="isConnected">
            <Circle class="h-2 w-2 fill-current text-green-500" />
            Connected
          </template>
          <template v-else-if="displayedError">
            <Circle class="h-2 w-2 fill-current text-red-500" />
            Disconnected
          </template>
          <template v-else>
            <Loader2 class="h-3 w-3 animate-spin" />
            Connecting…
          </template>
        </div>
      </div>
    </CardHeader>

    <div
      v-if="displayedError"
      role="alert"
      class="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs leading-relaxed text-destructive"
    >
      <template v-if="displayedError.code === 'ORIGIN_NOT_ALLOWED'">
        Origin
        <code class="rounded bg-destructive/15 px-1 py-0.5 font-mono text-[11px]">{{ (displayedError.details?.origin as string) || 'this page' }}</code>
        isn't whitelisted for this agent. Add it in the agent's allowed origins.
      </template>
      <template v-else-if="displayedError.code === 'MISSING_TOKEN'">
        Authentication required — provide a JWT for this agent.
      </template>
      <template v-else-if="displayedError.code === 'INVALID_TOKEN'">
        The provided token is invalid or expired.
      </template>
      <template v-else-if="displayedError.code === 'MISSING_AGENT_ID'">
        Missing <code class="rounded bg-destructive/15 px-1 py-0.5 font-mono text-[11px]">agentId</code> on the connection.
      </template>
      <template v-else-if="displayedError.code === 'TRANSPORT_ERROR'">
        Can't reach the hub: {{ displayedError.message || 'transport error' }}
      </template>
      <template v-else>
        {{ displayedError.message || displayedError.code || 'Connection error' }}
      </template>
    </div>

    <CardContent class="flex-1 overflow-hidden p-0">
      <ScrollArea ref="scrollRef" class="h-full">
        <div class="flex flex-col gap-4 p-4">
          <div
            v-if="messages.length === 0"
            class="flex-1 flex items-center justify-center text-muted-foreground text-sm py-12"
          >
            Start a conversation with the agent
          </div>

          <template v-for="msg in messages" :key="msg.id">
            <!-- A work-log entry carries the turn's reasoning instead of an
                 answer, and is drawn as a collapsed row rather than a bubble. -->
            <Thinking v-if="msg.steps" :message="msg" :label="thinkingLabel" />
            <Message v-else :message="msg" />
          </template>

          <div v-if="isTyping" class="flex gap-3 mr-auto">
            <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
              <Bot class="h-4 w-4" />
            </div>
            <div class="rounded-lg px-3 py-2 bg-muted">
              <div class="flex gap-1">
                <span class="h-2 w-2 rounded-full bg-foreground/40 animate-bounce [animation-delay:0ms]" />
                <span class="h-2 w-2 rounded-full bg-foreground/40 animate-bounce [animation-delay:150ms]" />
                <span class="h-2 w-2 rounded-full bg-foreground/40 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </CardContent>

    <!-- Information, not an error: muted colours, never the red of the banner.
         The ticking time is hidden from the live region so it is read once. -->
    <div
      v-if="isLimited"
      :id="LIMIT_NOTICE_ID"
      role="status"
      class="flex items-start gap-2 border-t bg-muted px-4 py-2 text-xs leading-relaxed text-muted-foreground"
    >
      <Clock class="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {{ limitLabel }}
        <span class="font-semibold tabular-nums text-foreground" aria-live="off">{{ limitRetryText }}</span>
      </span>
    </div>

    <CardFooter class="border-t p-3">
      <Input
        ref="inputRef"
        :placeholder="placeholder"
        :disabled="!isConnected"
        :send-disabled="isLimited"
        :described-by="LIMIT_NOTICE_ID"
        @send="handleSend"
      />
    </CardFooter>
  </Card>
</template>
