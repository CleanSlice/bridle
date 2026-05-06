# NPM (Bundler)

When you control the build (Vite, Next, Nuxt, Webpack, Rollup), use the npm package directly. You get tree-shaking, type definitions, and full programmatic control.

## Install

```bash
npm i @cleanslice/bridle
# or
pnpm add @cleanslice/bridle
# or
yarn add @cleanslice/bridle
```

## Usage

```ts
import { init } from '@cleanslice/bridle'

const chat = init({
  apiUrl: 'https://your-hub.example.com',
  botId: 'bot-abc-123',
  token: () => fetchJwt(),
  mount: '#chat',
  mode: 'inline',
})
```

## `init()` options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `apiUrl` | string | required* | Hub origin |
| `botId` | string | yes | Bot identifier |
| `token` | string \| `() => string \| Promise<string>` | yes | JWT or token-getter |
| `mount` | string \| `HTMLElement` | no | CSS selector or element. Default: `<body>` |
| `mode` | `'floating' \| 'inline'` | no | Default: `floating` |
| `title` | string | no | Header text. Default: `Agent Chat` |
| `placeholder` | string | no | Input placeholder |
| `theme` | `Record<string, string>` | no | CSS variable overrides |
| `onReady` | `() => void` | no | Fires when the WebSocket connects |
| `onMessage` | `(msg: IBridleMessage) => void` | no | Fires on each completed agent message |
| `onError` | `(err: Error) => void` | no | Fires on connection errors |

\* `apiUrl` can be omitted if the SDK was loaded from the same origin as the hub. With the bundler, you usually pass it explicitly.

## Returned instance

`init()` returns an `IBridleInstance`:

```ts
interface IBridleInstance {
  element: HTMLElement      // The <bridle-chat> custom element
  open(): void              // Open the panel (floating mode)
  close(): void             // Close the panel (floating mode)
  sendMessage(text: string): void
  destroy(): void           // Tear down and disconnect
}
```

## Token refresh

Pass a function instead of a string for tokens that expire:

```ts
init({
  apiUrl,
  botId,
  token: async () => {
    const res = await fetch('/api/bridle-token')
    return (await res.json()).token
  },
  mount: '#chat',
})
```

The function is called on each connect (initial mount and after disconnects). If your tokens are short-lived, the auto-reconnect of `socket.io-client` will pick up a fresh token transparently.

## Frameworks

### Vue 3

```vue
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { init, type IBridleInstance } from '@cleanslice/bridle'

const root = ref<HTMLDivElement | null>(null)
let chat: IBridleInstance | null = null

onMounted(() => {
  chat = init({
    apiUrl: import.meta.env.VITE_BRIDLE_URL,
    botId: 'bot-abc-123',
    token: localStorage.getItem('jwt')!,
    mount: root.value!,
    mode: 'inline',
  })
})

onBeforeUnmount(() => chat?.destroy())
</script>

<template>
  <div ref="root" style="height: 600px" />
</template>
```

### React

```tsx
import { useEffect, useRef } from 'react'
import { init, type IBridleInstance } from '@cleanslice/bridle'

export function Chat() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    let chat: IBridleInstance | null = null
    chat = init({
      apiUrl: import.meta.env.VITE_BRIDLE_URL,
      botId: 'bot-abc-123',
      token: localStorage.getItem('jwt')!,
      mount: ref.current,
      mode: 'inline',
    })
    return () => chat?.destroy()
  }, [])

  return <div ref={ref} style={{ height: 600 }} />
}
```

### Next.js (App Router)

The SDK touches `window` and `document` — load it client-side only:

```tsx
'use client'

import dynamic from 'next/dynamic'
const Chat = dynamic(() => import('./chat-component'), { ssr: false })

export default function Page() {
  return <Chat />
}
```

## TypeScript

All types are exported:

```ts
import type {
  BridlePart,
  IBridleMessage,
  IBridleInitOptions,
  IBridleInstance,
} from '@cleanslice/bridle'
```
