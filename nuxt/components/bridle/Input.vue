<script setup lang="ts">
import { ref } from 'vue'
import { Textarea } from '#theme/components/ui/textarea'
import { Button } from '#theme/components/ui/button'
import { Send } from 'lucide-vue-next'

const props = defineProps<{
  placeholder?: string
  disabled?: boolean
  /**
   * Sending is unavailable but typing is not — the agent's request limit is
   * full. The field stays editable; Send and Enter do nothing until it opens.
   */
  sendDisabled?: boolean
  /** Id of the element that says why Send is unavailable, for assistive tech. */
  describedBy?: string
}>()

const emit = defineEmits<{
  send: [text: string]
}>()

const input = ref('')
const textareaRef = ref<InstanceType<typeof Textarea> | null>(null)

const handleSend = () => {
  if (!input.value.trim()) return
  // Checked before the field is cleared: what was typed stays for the retry.
  if (props.sendDisabled) return
  emit('send', input.value)
  input.value = ''
  textareaRef.value?.$el?.focus()
}

/**
 * Put back a message the hub refused. Whatever was typed since stays, below
 * the text that came back.
 */
const restore = (text: string) => {
  input.value = input.value.trim() ? `${text}\n${input.value}` : text
  textareaRef.value?.$el?.focus()
}

defineExpose({ restore })

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}
</script>

<template>
  <div class="flex w-full gap-2">
    <Textarea
      ref="textareaRef"
      v-model="input"
      :placeholder="placeholder"
      :disabled="disabled"
      class="min-h-[36px] max-h-[120px] resize-none"
      :rows="1"
      @keydown="handleKeydown"
    />
    <Button
      size="icon"
      :disabled="!input.trim() || disabled || sendDisabled"
      :aria-describedby="sendDisabled ? describedBy : undefined"
      class="shrink-0"
      @click="handleSend"
    >
      <Send class="h-4 w-4" />
    </Button>
  </div>
</template>
