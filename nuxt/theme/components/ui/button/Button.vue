<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../utils/cn'

const props = withDefaults(defineProps<{
  class?: HTMLAttributes['class']
  disabled?: boolean
  size?: 'default' | 'sm' | 'lg' | 'icon'
  variant?: 'default' | 'secondary' | 'ghost' | 'outline'
}>(), {
  size: 'default',
  variant: 'default',
})
</script>

<template>
  <button
    :class="cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors',
      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
      'disabled:pointer-events-none disabled:opacity-50',
      variant === 'default' && 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
      variant === 'secondary' && 'bg-muted text-muted-foreground hover:bg-muted/80',
      variant === 'ghost' && 'hover:bg-muted hover:text-foreground',
      variant === 'outline' && 'border border-input bg-background hover:bg-muted',
      size === 'default' && 'h-9 px-4 py-2',
      size === 'sm' && 'h-8 rounded-md px-3 text-xs',
      size === 'lg' && 'h-10 rounded-md px-8',
      size === 'icon' && 'h-9 w-9',
      props.class,
    )"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>
