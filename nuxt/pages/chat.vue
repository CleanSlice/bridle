<script setup lang="ts">
import { useBridleStore } from '#bridle/stores/bridle'

const API = 'http://localhost:3333'
const route = useRoute()

const agentId = computed(() => (route.query.bot as string) || 'default')
const token = ref('')
const error = ref('')

const store = useBridleStore()

watch(agentId, () => {
  store.disconnect()
  store.clearMessages()
  token.value = ''
  error.value = ''
  fetchToken()
})

async function fetchToken() {
  try {
    const res = await $fetch<{ token: string }>(`${API}/api/auth/token`)
    token.value = res.token
  } catch {
    error.value = 'Cannot connect to hub'
  }
}

onMounted(fetchToken)
onUnmounted(() => store.disconnect())
</script>

<template>
  <div>
    <div class="mb-4">
      <h1 class="text-2xl font-bold tracking-tight">Chat</h1>
      <p class="text-sm text-muted-foreground">
        Talking to <code class="bg-muted px-1.5 py-0.5 rounded text-xs">{{ agentId }}</code>
      </p>
    </div>

    <Provider
      v-if="token"
      :api-url="API"
      :agent-id="agentId"
      :token="token"
      :title="`Agent: ${agentId}`"
      class="w-full max-w-3xl h-[calc(100vh-12rem)]"
    />

    <div v-else-if="error" class="text-center py-12">
      <p class="text-muted-foreground text-sm">{{ error }}</p>
    </div>
    <div v-else class="text-center py-12">
      <p class="text-muted-foreground text-sm">Connecting...</p>
    </div>
  </div>
</template>
