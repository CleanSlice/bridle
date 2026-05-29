<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'

// Same public demo agent as the homepage hero. Origin-whitelisted on the
// hub, so no JWT is needed for the live demo.
const DEFAULT_API_URL = 'https://api.ranch.cleanslice.org'
const DEFAULT_AGENT_ID = 'agent-74c579f3-4700-4531-84f6-f8a621f98fa3'

const props = withDefaults(
  defineProps<{
    apiUrl?: string
    agentId?: string
    title?: string
    placeholder?: string
    theme?: 'default' | 'cleanslice'
    colorMode?: 'auto' | 'light' | 'dark'
    themeVars?: Record<string, string>
    customCss?: string
    height?: string
    greeting?: string
    greetingDelay?: number
    fabIcon?: string
  }>(),
  {
    apiUrl: DEFAULT_API_URL,
    agentId: DEFAULT_AGENT_ID,
    title: 'Bridle demo',
    placeholder: 'Ask the demo bot anything…',
    theme: 'cleanslice',
    colorMode: 'auto',
    height: '520px',
  },
)

const mountEl = ref<HTMLDivElement | null>(null)
const error = ref<string | null>(null)
let instance: { destroy: () => void } | null = null

onMounted(async () => {
  if (typeof window === 'undefined' || !mountEl.value) return

  try {
    // Variable indirection so Rollup doesn't try to resolve the URL at
    // build time. /sdk/latest.mjs is served from public/ at runtime.
    const sdkUrl = '/sdk/latest.mjs'
    const mod = await import(/* @vite-ignore */ sdkUrl)
    instance = mod.init({
      apiUrl: props.apiUrl,
      agentId: props.agentId,
      mount: mountEl.value,
      mode: 'inline',
      title: props.title,
      placeholder: props.placeholder,
      theme: props.theme,
      colorMode: props.colorMode,
      themeVars: props.themeVars,
      customCss: props.customCss,
      greeting: props.greeting,
      greetingDelay: props.greetingDelay,
      fabIcon: props.fabIcon,
      onError: (err: Error) => {
        error.value = err.message || String(err)
      },
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

onBeforeUnmount(() => {
  instance?.destroy()
  instance = null
})
</script>

<template>
  <div class="bridle-embed">
    <div
      ref="mountEl"
      class="bridle-embed__mount"
      :style="{ height }"
    />
    <p v-if="error" class="bridle-embed__error">Demo unavailable: {{ error }}</p>
  </div>
</template>

<style scoped>
.bridle-embed {
  width: 100%;
  max-width: 480px;
  margin: 24px 0;
}

.bridle-embed__mount {
  width: 100%;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.16);
  border: 1px solid var(--vp-c-border);
  background: var(--vp-c-bg-elv);
}

.bridle-embed__error {
  margin-top: 12px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}

@media (max-width: 768px) {
  .bridle-embed {
    max-width: 100%;
  }
}
</style>
