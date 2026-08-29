<script setup lang="ts">
import { computed, ref } from 'vue'
import type { IBridleMessageData } from '../../stores/bridle'
import { Check, ChevronRight, Loader2, Sparkles } from 'lucide-vue-next'
import { cn } from '#theme/utils/cn'

/**
 * The work log — one collapsed row per turn holding what the agent thought
 * and which tools it reached for.
 *
 * NOT a bubble, on purpose. This is the agent talking to itself; drawn like
 * an answer it competes with the answer, and the visitor reads three grey
 * paragraphs of reasoning before finding the reply. See the store's
 * `pushStep`, and docs/PROTOCOL.md § Notes.
 */
const props = defineProps<{
  message: IBridleMessageData
  /** Caption of the collapsed row once the turn has finished. */
  label?: string
}>()

/** The visitor's own decision to see the whole trace. Collapsed by default. */
const open = ref(false)

const steps = computed(() => props.message.steps ?? [])

/**
 * What the collapsed row says.
 *
 * While the turn runs it is the step the agent is on RIGHT NOW, not the
 * caption: during reasoning there is nothing else on screen, and a row that
 * only said «Work log · 7 steps» next to a spinner is indistinguishable from
 * a hung page. Once the answer lands the caption takes over — by then the
 * moving part is the answer itself.
 */
const summary = computed(() => {
  if (!props.message.live) return props.label ?? 'Work log'
  return steps.value[steps.value.length - 1]?.text || (props.label ?? 'Work log')
})

const count = computed(() => {
  const n = steps.value.length
  return `${n} ${n === 1 ? 'step' : 'steps'}`
})
</script>

<template>
  <div
    class="mr-auto w-full max-w-[85%] overflow-hidden rounded-lg border bg-muted/40"
    data-testid="bridle-thinking"
    :data-live="message.live ? 'true' : 'false'"
    :data-open="open ? 'true' : 'false'"
  >
    <button
      type="button"
      class="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70"
      data-testid="bridle-thinking-toggle"
      :aria-expanded="open"
      @click="open = !open"
    >
      <Loader2 v-if="message.live" class="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
      <Sparkles v-else class="h-3.5 w-3.5 shrink-0" />

      <span class="min-w-0 flex-1 truncate text-left" :title="summary">{{ summary }}</span>
      <span class="shrink-0 tabular-nums">· {{ count }}</span>

      <ChevronRight :class="cn('ml-1 h-4 w-4 shrink-0 transition-transform', open && 'rotate-90')" />
    </button>

    <div v-if="open" class="space-y-2 px-3 pb-3 pt-1" data-testid="bridle-thinking-steps">
      <div
        v-for="step in steps"
        :key="step.id"
        class="flex items-start gap-2 text-xs text-muted-foreground"
      >
        <Loader2 v-if="step.running" class="mt-0.5 h-3 w-3 shrink-0 animate-spin text-primary" />
        <Check v-else class="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
        <span class="whitespace-pre-wrap break-words">{{ step.text }}</span>
      </div>
    </div>
  </div>
</template>
