# NPM (Bundler)

When you control the build (Vite, Next, Nuxt, Webpack, Rollup), use the npm package directly. You get tree-shaking, type definitions, and full programmatic control.

## Install

```bash
bun add @cleanslice/bridle
# or
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
  agentId: 'agent-abc-123',
  token: () => fetchJwt(),
  mount: '#chat',
  mode: 'inline',
})
```

## `init()` options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `apiUrl` | string | required* | Hub origin |
| `agentId` | string | yes | Bot identifier |
| `token` | string \| `() => string \| Promise<string>` | yes | JWT, or a token provider (recommended — see [Token refresh](#token-refresh)) |
| `mount` | string \| `HTMLElement` | no | CSS selector or element. Default: `<body>` |
| `mode` | `'floating' \| 'inline'` | no | Default: `floating` |
| `title` | string | no | Header text. Default: `Agent Chat` |
| `placeholder` | string | no | Input placeholder |
| `accept` | string | no | File types the attachment picker offers. Default: `image/*`. See [Attachments](#attachments) |
| `uploadUrl` | string | no | Endpoint that stores a non-image attachment and answers with its URL |
| `enableImages` | boolean | no | Pictures in the conversation, both directions. Default: `true` |
| `theme` | `Record<string, string>` | no | CSS variable overrides |
| `customCss` | string | no | Inline CSS injected into the shadow root. See [Theming › Overriding internal classes](/embed/theming#overriding-internal-classes) |
| `stylesheets` | `string \| string[]` | no | Stylesheet URL(s) loaded into the shadow root as `<link rel="stylesheet">` |
| `onReady` | `() => void` | no | Fires when the WebSocket connects |
| `onMessage` | `(msg: IBridleMessage) => void` | no | Fires on each completed agent message |
| `onError` | `(err: Error) => void` | no | Fires on connection errors |
| `onTokenExpired` | `() => void` | no | A static `token` was rejected and the widget cannot renew it — answer with `chat.setToken()` |
| `sessionExpiredLabel` | string | no | Banner text when the session could not be renewed. Default: `Your session has expired.` |
| `reconnectLabel` | string | no | Banner button. Default: `Reconnect` |
| `reloadLabel` | string | no | Banner button for static tokens. Default: `Reload the page` |
| `onLimit` | `(state: IBridleLimitState) => void` | no | The agent's request limit filled up or opened again. See [Request limits](#request-limits) |
| `limitLabel` | string | no | First line of the limit notice. Default: `This agent has reached its message limit.` |
| `limitRetryLabel` | string | no | Second line of the limit notice; `{time}` is replaced by the countdown or the time of day. Default: `Try again in {time}.` |

\* `apiUrl` can be omitted if the SDK was loaded from the same origin as the hub. With the bundler, you usually pass it explicitly.

## Returned instance

`init()` returns an `IBridleInstance`:

```ts
interface IBridleInstance {
  element: HTMLElement      // The <bridle-chat> custom element
  open(): void              // Open the panel (floating mode)
  close(): void             // Close the panel (floating mode)
  sendMessage(text: string): void // Sends nothing while the agent's limit is full — onLimit fires again
  setToken(token: string): void // Replace a static token; reconnects, keeps the conversation
  destroy(): void           // Tear down and disconnect
}
```

## Request limits

A hub can cap how many requests an agent takes per minute, hour and day. When a limit is full the widget does not show an error. A calm notice sits on top of the message field:

```
(clock)  This agent has reached its message limit.
         Try again in 0:42.
```

- The message that was refused does not stay in the conversation, and no typing dots start. Its text and attachments are back in the message field.
- The visitor can keep typing and reading. The Send button is unavailable (`aria-disabled`, described by the notice) and Enter sends nothing — either one nudges the notice instead of failing silently. Suggestion chips and form buttons are disabled for the wait.
- When the wait ends the notice says "You can send your message now." for a moment and leaves. **Nothing is sent automatically** — the visitor presses Send.
- When an hour or day limit is already full, the hub says so on connect and the notice is there before anything is typed.
- "New chat" does not clear the wait: the limit is the agent's, not the conversation's.

| The wait is | The second line reads |
|-------------|-----------------------|
| Under an hour | `Try again in 0:42.` / `Try again in 12:05.` — ticking |
| An hour or more, same day | `Try again after 14:30.` — the local time of day, formatted by the browser's locale |
| Past midnight | `Try again tomorrow after 09:15.` |

Both lines can be replaced:

```ts
init({
  // …
  limitLabel: 'Our assistant is busy right now.',
  limitRetryLabel: 'Please try again in {time}.',
})
```

`{time}` becomes the countdown (`0:42`). The "after" / "tomorrow after" wording for long waits and the "You can send your message now." line are built in and English; with your own `limitRetryLabel`, a wait of an hour or more puts the bare time of day into `{time}`.

To react on the page — hide a "Ask our assistant" button, log it, offer another channel — use `onLimit`:

```ts
interface IBridleLimitState {
  limited: boolean
  retryAfterMs?: number                 // present when limited
  window?: 'minute' | 'hour' | 'day'    // present when limited
}

const chat = init({
  // …
  onLimit: ({ limited, retryAfterMs }) => {
    askButton.disabled = limited
    if (limited) console.log(`assistant is back in ${Math.ceil(retryAfterMs / 1000)} s`)
  },
})
```

It is called with `limited: true` when a send is refused, when the hub announces a full hour or day limit, and when `chat.sendMessage()` is tried during the wait (nothing is sent; you get the remaining wait). It is called with `limited: false` when the wait ends. `onError` is not called for a limit.

The same state is dispatched on the element as a `limit` event. Vue passes a custom element's event arguments as an array, so the state is `event.detail[0]`:

```ts
chat.element.addEventListener('limit', (e) => {
  const state = (e as CustomEvent<[IBridleLimitState]>).detail[0]
})
```

A widget older than 0.16.0 cannot show the notice; the hub sends it a plain assistant line instead ("This agent has reached its message limit. Try again in about 40 seconds.").

## Attachments

The picker offers images by default, and the widget sends them inline as
base64. Anything else travels through the protocol as a URL — `{ type: 'file',
url, name, mimeType }` — and the hub deliberately does not host files. So a
document attachment needs two things: a picker that offers the type, and
somewhere to put the bytes.

```js
init({
  agentId: 'bot-abc-123',
  accept: 'image/*,application/pdf,.docx',
  uploadUrl: 'https://your-api.example.com/attachment',
});
```

`uploadUrl` receives `POST` as `multipart/form-data` with the file in a `file`
field and answers `{ url, name?, mimeType? }`, or the same object under a
`data` key. The `token` given to `init()` is forwarded as `Authorization`.
Widen `accept` without `uploadUrl` and the widget says so next to the input
rather than dropping the file quietly. Limits: 5 attachments per message,
10 MB each.

### Turning pictures off

```js
init({ agentId: 'bot-abc-123', enableImages: false });
```

This closes both directions at once. The picker disappears and pasted or
dropped images are refused — and, just as importantly, the handshake stops
advertising the `images` capability, which is what tells the agent not to
answer with one. Hiding the picker alone would only cover the visitor's side.

Documents are unaffected: with `uploadUrl` configured the picker stays for
them, so `enableImages: false` plus an upload endpoint gives a
documents-only widget.

## Token refresh

Embed tokens are short-lived by design (`POST /auth/embed/token` defaults to `15m`): the long-lived credential is your server-side API key, never the browser JWT. So the widget has to be able to get the next token on its own. **Pass a token provider** — a function that asks your backend for a fresh token:

```ts
init({
  apiUrl,
  agentId,
  token: () => fetch('/my-backend/bridle-token').then((r) => r.json()).then((j) => j.token),
  mount: '#chat',
})
```

Your backend mints the token with an `embed:mint` API key, which never reaches the browser:

```ts
// GET /my-backend/bridle-token — behind your own session check
app.get('/my-backend/bridle-token', async (req, res) => {
  const r = await fetch(`${RANCH_URL}/auth/embed/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RANCH_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sub: req.user.id, email: req.user.email }), // expiresIn defaults to 15m
  })
  res.json({ token: (await r.json()).token })
})
```

The widget calls the provider:

- once for the first token;
- again ~60 s before each token's `exp` (read from the JWT payload), so a reconnect after a long idle already carries a valid token — between those calls the token is cached;
- whenever the hub turns the current token away (`TOKEN_EXPIRED` / `INVALID_TOKEN` on the socket, `401` on HTTP calls such as the transcript), then reconnects or retries once.

The visitor sees the usual "connecting" spinner during a renewal; the conversation stays on screen and messages typed meanwhile are sent once the chat is back. Only when the provider itself fails, or a just-renewed token is rejected again (at most one forced renewal per 30 s), the widget shows "Your session has expired" with a **Reconnect** button that runs the provider again.

::: warning Don't stretch `expiresIn` instead
A long-lived browser JWT works around nothing: it still expires (and then breaks the same way), and anyone who copies it from the page keeps chat access until then. Keep embed tokens short and pass a provider.
:::

### Static tokens

A string token still works, but the widget cannot renew it. When the hub rejects it, the widget fires `onTokenExpired` (the `token-expired` event on the element) and shows "Your session has expired" with **Reconnect** (fires `onTokenExpired` again) and **Reload the page**. Push a new token from your page and the chat reconnects, keeping the conversation:

```ts
const chat = init({
  apiUrl,
  agentId,
  token: initialJwt,
  onTokenExpired: async () => chat.setToken(await getNewJwtSomehow()),
})
```

Setting the element's `token` attribute does the same as `setToken()`.

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
    agentId: 'agent-abc-123',
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
      agentId: 'agent-abc-123',
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
