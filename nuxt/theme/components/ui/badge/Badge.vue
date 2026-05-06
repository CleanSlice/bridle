<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../utils/cn'

const props = withDefaults(defineProps<{
  class?: HTMLAttributes['class']
  variant?: 'default' | 'secondary' | 'outline' | 'destructive'
}>(), { variant: 'default' })
</script>

<template>
  <span
    :class="cn(
      'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors',
      variant === 'default' && 'border-transparent bg-primary text-primary-foreground',
      variant === 'secondary' && 'border-transparent bg-muted text-muted-foreground',
      variant === 'outline' && 'text-foreground',
      variant === 'destructive' && 'border-transparent bg-red-500 text-white',
      props.class,
    )"
  >
    <slot />
  </span>
</template>
