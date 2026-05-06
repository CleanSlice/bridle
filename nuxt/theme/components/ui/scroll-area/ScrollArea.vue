<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../utils/cn'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <div :class="cn('relative overflow-hidden', props.class)">
    <div class="h-full w-full overflow-auto" data-radix-scroll-area-viewport>
      <slot />
    </div>
  </div>
</template>
