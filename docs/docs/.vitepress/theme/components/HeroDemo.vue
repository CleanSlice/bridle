<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'

const API_URL = 'https://api.ranch.cleanslice.org'
const AGENT_ID = 'agent-99c9f935-1bff-4f1f-a9a8-cc09bb3e6011'

const mountEl = ref<HTMLDivElement | null>(null)
const error = ref<string | null>(null)
let instance: { destroy: () => void } | null = null

onMounted(async () => {
  if (typeof window === 'undefined' || !mountEl.value) return

  try {
    // Imported dynamically (not top-level) so VitePress's SSR build never
    // evaluates the SDK, which touches `window`/`document` on load.
    const { init } = await import('@cleanslice/bridle')
    instance = init({
      apiUrl: API_URL,
      agentId: AGENT_ID,
      mount: mountEl.value,
      mode: 'inline',
      // Title, greeting and placeholder come from the agent's own config.
      theme: 'cleanslice',
      colorMode: 'auto',
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
  <div class="hero-demo">
    <div ref="mountEl" class="hero-demo__mount" />
    <p v-if="error" class="hero-demo__error">Demo unavailable: {{ error }}</p>
  </div>
</template>

<style scoped>
.hero-demo {
  width: 100%;
  max-width: 440px;
  margin: 0 auto;
}

.hero-demo__mount {
  width: 100%;
  height: 520px;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: var(--cs-glow-box, 0 12px 40px rgba(0, 0, 0, 0.16));
  border: 1px solid var(--vp-c-border);
  background: var(--vp-c-bg-elv);
}

.hero-demo__error {
  margin-top: 12px;
  font-size: 13px;
  color: var(--vp-c-text-2);
  text-align: center;
}

@media (max-width: 959px) {
  .hero-demo {
    max-width: 100%;
    margin-top: 24px;
  }
  .hero-demo__mount {
    height: 440px;
  }
}
</style>
