<script setup lang="ts">
import { Bot, MessageSquare, Activity, Menu, X } from 'lucide-vue-next'

const route = useRoute()
const mobileOpen = ref(false)

const nav = [
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/health', label: 'Health', icon: Activity },
]

watch(() => route.path, () => { mobileOpen.value = false })
</script>

<template>
  <div class="min-h-screen bg-background">
    <!-- Header -->
    <header class="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div class="flex h-14 items-center px-4 gap-4">
        <button class="md:hidden" @click="mobileOpen = !mobileOpen">
          <Menu v-if="!mobileOpen" class="h-5 w-5" />
          <X v-else class="h-5 w-5" />
        </button>

        <NuxtLink to="/" class="flex items-center gap-2 font-semibold">
          <Bot class="h-5 w-5" />
          <span>Bridle</span>
        </NuxtLink>

        <!-- Desktop nav -->
        <nav class="hidden md:flex items-center gap-1 ml-6">
          <NuxtLink
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            :class="[
              'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors',
              route.path.startsWith(item.to)
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
            ]"
          >
            <component :is="item.icon" class="h-4 w-4" />
            {{ item.label }}
          </NuxtLink>
        </nav>

        <div class="ml-auto flex items-center gap-2">
          <span class="text-xs text-muted-foreground hidden sm:block">Hub: localhost:3333</span>
        </div>
      </div>

      <!-- Mobile nav -->
      <nav v-if="mobileOpen" class="md:hidden border-t px-4 py-2 space-y-1">
        <NuxtLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          :class="[
            'flex items-center gap-2 px-3 py-2 rounded-md text-sm',
            route.path.startsWith(item.to)
              ? 'bg-muted text-foreground font-medium'
              : 'text-muted-foreground',
          ]"
        >
          <component :is="item.icon" class="h-4 w-4" />
          {{ item.label }}
        </NuxtLink>
      </nav>
    </header>

    <!-- Content -->
    <main class="mx-auto max-w-6xl px-4 py-6">
      <slot />
    </main>
  </div>
</template>
