<script setup lang="ts">
import { Bot, Circle, RefreshCw, Users } from 'lucide-vue-next'
import { Badge } from '#theme/components/ui/badge'
import { Card, CardContent, CardHeader } from '#theme/components/ui/card'
import { Button } from '#theme/components/ui/button'
import { Separator } from '#theme/components/ui/separator'

const API = 'http://localhost:3333'

interface IAgentInfo {
  agentId: string
  clients: number
}

interface IHealthData {
  ok: boolean
  agentConnected: boolean
  browserClients: number
}

const agents = ref<IAgentInfo[]>([])
const health = ref<IHealthData | null>(null)
const loading = ref(true)

async function refresh() {
  loading.value = true
  try {
    const [h, list] = await Promise.all([
      $fetch<IHealthData>(`${API}/api/agent/health`),
      $fetch<IAgentInfo[]>(`${API}/api/agent/list`),
    ])
    health.value = h
    agents.value = list
  } catch (e) {
    console.error('Failed to fetch agents:', e)
  } finally {
    loading.value = false
  }
}

let interval: ReturnType<typeof setInterval>
onMounted(() => {
  refresh()
  interval = setInterval(refresh, 5000)
})
onUnmounted(() => clearInterval(interval))
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Agents</h1>
        <p class="text-sm text-muted-foreground">Connected bot agents and their status</p>
      </div>
      <Button variant="outline" size="sm" :disabled="loading" @click="refresh">
        <RefreshCw :class="['h-4 w-4 mr-2', loading && 'animate-spin']" />
        Refresh
      </Button>
    </div>

    <!-- Health summary -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6" v-if="health">
      <Card>
        <CardContent class="p-4 flex items-center gap-3">
          <div :class="['h-2.5 w-2.5 rounded-full', health.ok ? 'bg-green-500' : 'bg-red-500']" />
          <div>
            <p class="text-sm font-medium">Hub Status</p>
            <p class="text-xs text-muted-foreground">{{ health.ok ? 'Online' : 'Offline' }}</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="p-4 flex items-center gap-3">
          <Bot class="h-4 w-4 text-muted-foreground" />
          <div>
            <p class="text-sm font-medium">{{ agents.length }} Agent{{ agents.length !== 1 ? 's' : '' }}</p>
            <p class="text-xs text-muted-foreground">Connected</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="p-4 flex items-center gap-3">
          <Users class="h-4 w-4 text-muted-foreground" />
          <div>
            <p class="text-sm font-medium">{{ health.browserClients }} Client{{ health.browserClients !== 1 ? 's' : '' }}</p>
            <p class="text-xs text-muted-foreground">Browser sessions</p>
          </div>
        </CardContent>
      </Card>
    </div>

    <Separator class="mb-6" />

    <!-- Agent list -->
    <div v-if="agents.length" class="space-y-3">
      <Card v-for="agent in agents" :key="agent.agentId">
        <CardContent class="p-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
              <Bot class="h-4 w-4" />
            </div>
            <div>
              <p class="font-medium text-sm">{{ agent.agentId }}</p>
              <p class="text-xs text-muted-foreground">{{ agent.clients }} active client{{ agent.clients !== 1 ? 's' : '' }}</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <Badge variant="default">
              <Circle class="h-2 w-2 fill-current mr-1" />
              Online
            </Badge>
            <NuxtLink :to="`/chat?bot=${agent.agentId}`">
              <Button size="sm" variant="outline">Open Chat</Button>
            </NuxtLink>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Empty state -->
    <Card v-else-if="!loading">
      <CardContent class="p-8 text-center">
        <Bot class="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
        <p class="font-medium mb-1">No agents connected</p>
        <p class="text-sm text-muted-foreground mb-4">
          Start a runtime agent with <code class="bg-muted px-1.5 py-0.5 rounded text-xs">BRIDLE_URL=http://localhost:3333</code>
        </p>
      </CardContent>
    </Card>
  </div>
</template>
