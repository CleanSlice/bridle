<script setup lang="ts">
import { Activity, Circle, RefreshCw } from 'lucide-vue-next'
import { Card, CardContent, CardHeader } from '#theme/components/ui/card'
import { Button } from '#theme/components/ui/button'
import { Badge } from '#theme/components/ui/badge'

const API = 'http://localhost:3333'

const data = ref<Record<string, unknown> | null>(null)
const loading = ref(true)
const lastUpdated = ref('')

async function refresh() {
  loading.value = true
  try {
    data.value = await $fetch(`${API}/api/agent/health`)
    lastUpdated.value = new Date().toLocaleTimeString()
  } catch (e) {
    data.value = { ok: false, error: 'Hub unreachable' }
  } finally {
    loading.value = false
  }
}

let interval: ReturnType<typeof setInterval>
onMounted(() => {
  refresh()
  interval = setInterval(refresh, 3000)
})
onUnmounted(() => clearInterval(interval))
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Health</h1>
        <p class="text-sm text-muted-foreground">Real-time hub status (auto-refresh 3s)</p>
      </div>
      <div class="flex items-center gap-3">
        <span v-if="lastUpdated" class="text-xs text-muted-foreground">{{ lastUpdated }}</span>
        <Button variant="outline" size="sm" :disabled="loading" @click="refresh">
          <RefreshCw :class="['h-4 w-4 mr-2', loading && 'animate-spin']" />
          Refresh
        </Button>
      </div>
    </div>

    <Card v-if="data" class="max-w-lg">
      <CardHeader class="pb-3">
        <div class="flex items-center gap-2">
          <Activity class="h-4 w-4" />
          <span class="font-semibold text-sm">Hub Status</span>
          <Badge :variant="data.ok ? 'default' : 'destructive'" class="ml-auto">
            <Circle class="h-2 w-2 fill-current mr-1" />
            {{ data.ok ? 'Online' : 'Offline' }}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <pre class="text-xs bg-muted rounded-md p-3 overflow-auto">{{ JSON.stringify(data, null, 2) }}</pre>
      </CardContent>
    </Card>
  </div>
</template>
