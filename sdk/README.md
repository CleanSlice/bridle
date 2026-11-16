# @cleanslice/bridle

Embeddable webchat for [Bridle](https://bridle.cleanslice.org). One Web Component, three integration paths: drop-in `<script>`, npm + bundler, or headless client.

## Drop-in script (no build step)

```html
<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-api-url="https://your-hub.example.com"
  data-agent-id="agent-abc-123"
  data-token="<jwt>"
></script>
```

The script auto-mounts a floating chat bubble in the bottom-right corner. If the SDK is served from your hub origin, `data-api-url` can be omitted — it's inferred from the script's URL.

### Available `data-*` attributes

| Attribute | Default | Description |
|-----------|---------|-------------|
| `data-agent-id` | required | Agent identifier registered on the hub |
| `data-token` | optional | JWT for browser auth (omit for public agents). Static — see [Token refresh](#token-refresh) |
| `data-api-url` | inferred | Hub origin |
| `data-mode` | `floating` | `floating` (FAB) or `inline` (mounted inside `data-mount`) |
| `data-mount` | `<body>` | CSS selector for inline mode |
| `data-title` | `Agent Chat` | Header text |
| `data-placeholder` | `Type a message...` | Input placeholder |
| `data-accept` | `image/*` | File types the attachment picker offers |
| `data-upload-url` | optional | Endpoint that stores a non-image attachment and answers with its URL |
| `data-enable-images` | `true` | Pictures in the conversation, both directions. `false` turns them off |
| `data-limit-label` | `This agent has reached its message limit.` | First line of the [request-limit notice](#request-limits) |
| `data-limit-retry-label` | `Try again in {time}.` | Second line; `{time}` is the countdown or the time of day |
| `data-custom-css` | optional | Inline CSS injected into the shadow root |
| `data-stylesheet` | optional | Stylesheet URL(s) loaded into the shadow root (comma-separate for multiple) |

## Programmatic init

```js
import { init } from '@cleanslice/bridle'

const chat = init({
  apiUrl: 'https://your-hub.example.com',
  agentId: 'agent-abc-123',
  token: () => fetchJwt(),     // token provider (recommended) or a static string
  mount: '#chat',              // CSS selector or HTMLElement
  mode: 'inline',
  title: 'Support',
  theme: { '--bridle-primary': '#0070f3' },
  onReady: () => {},
  onMessage: (msg) => console.log(msg.text),
  onError: (err) => console.error(err),
  onLimit: ({ limited, retryAfterMs }) => {},  // the agent's request limit filled / opened
})

chat.sendMessage('Hi!')
chat.open()
chat.close()
chat.setToken(jwt)             // replace a static token; reconnects, keeps the chat
chat.destroy()
```

## Token refresh

Embed tokens are short-lived on purpose (`POST /auth/embed/token` defaults to
`15m`); the long-lived credential is your server-side API key. Pass a **token
provider** and the widget keeps itself signed in:

```js
init({
  apiUrl,
  agentId,
  token: () => fetch('/my-backend/bridle-token').then((r) => r.json()).then((j) => j.token),
})
```

The provider is called for the first token, ~60 s before each token's `exp`,
and after the hub rejects a token (`TOKEN_EXPIRED` / `INVALID_TOKEN`, HTTP
`401`) — then the widget reconnects or retries once, keeping the conversation.
If that fails too, the visitor sees "Your session has expired" with a
**Reconnect** button instead of a raw error code.

With a static string token the widget cannot renew: it fires `onTokenExpired`
(`token-expired` on the element), and `chat.setToken(newJwt)` reconnects.
Don't work around expiry with a long `expiresIn` — a long-lived browser JWT
still expires, and leaks for longer. Full guide:
[bridle.cleanslice.org/embed/npm#token-refresh](https://bridle.cleanslice.org/embed/npm#token-refresh).

## Request limits

A hub can cap how many requests an agent takes per minute, hour and day. When
a limit is full the widget shows a calm notice on top of the message field
instead of an error:

```
This agent has reached its message limit.
Try again in 0:42.
```

The refused message does not stay in the conversation and no typing dots
start; its text and attachments are back in the message field. The visitor can
keep typing, Send is unavailable until the countdown ends, and nothing is sent
automatically when it does. A wait of an hour or more reads "Try again after
14:30." instead of a running clock.

```js
init({
  /* … */
  limitLabel: 'Our assistant is busy right now.',   // line 1
  limitRetryLabel: 'Please try again in {time}.',   // line 2, {time} → 0:42
  onLimit: ({ limited, retryAfterMs, window }) => {
    // limited: true  — a send was refused, the hub announced a full limit,
    //                  or sendMessage() was tried during the wait
    // limited: false — the wait is over
  },
})
```

Script tag: `data-limit-label`, `data-limit-retry-label`; the element
dispatches a `limit` event whose `detail[0]` is the same state. While limited,
`chat.sendMessage()` and headless `client.send()` send nothing and report the
remaining wait through `limit` again. A full limit never reaches `onError`.

Headless: `client.on('limit', (state) => …)`, `client.getLimit()`, and
`client.send()` now returns a promise of the hub's answer
(`accepted` / `rejected` with a `code` / `unacknowledged`) that never rejects.
Wire format: [PROTOCOL.md § Request limits](../docs/PROTOCOL.md#request-limits).

## Work log (agent reasoning)

Runtimes that reason out loud send those lines while they work. The widget
never draws them as answers — the notes of one turn fold into a single
collapsed row above the reply:

```
✦ Work log                                   · 3 steps  ›
```

While the turn runs the row shows the step the agent is on right now next to a
spinner, so a long chain never looks like a hung page; once the answer lands it
settles to its caption. It starts collapsed, and only the visitor opens it.

```js
init({ /* … */ thinkingLabel: 'Thinking' })   // rename the row
init({ /* … */ thinkingLabel: '' })           // hide reasoning entirely
```

Or on a script tag: `data-thinking-label="Thinking"`.

Nothing is required of the agent — notes sent between `typing` and
`stream_end` are recognised as such. Marking them with
`kind: "thinking" | "tool"` is preferred; see
[PROTOCOL.md § Notes](../docs/PROTOCOL.md#notes-agent-reasoning).

## Headless client (no UI)

```js
import { BridleClient } from '@cleanslice/bridle'

const client = new BridleClient({
  apiUrl: 'https://your-hub.example.com',
  agentId: 'agent-abc-123',
  token: 'eyJhbG...',
})

client.on('message', (m) => console.log(m.text))
client.on('stream', (m) => render(m.text))      // partial text as it streams
client.on('stream_end', (m) => finalize(m.text))

await client.connect()
client.send('hello')
```

## Theming

Override CSS custom properties on the `<bridle-chat>` element (or via the `theme` option):

```css
bridle-chat {
  --bridle-primary: #0070f3;
  --bridle-primary-fg: #ffffff;
  --bridle-bg: #ffffff;
  --bridle-fg: #111827;
  --bridle-muted: #6b7280;
  --bridle-bubble-bg: #f3f4f6;
  --bridle-border: #e5e7eb;
  --bridle-radius: 14px;
  --bridle-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
}
```

The element uses Shadow DOM, so host page styles never bleed in and component styles never bleed out.

### Restyling internal elements

## Attachments

Images ride inside the message as base64 and need no configuration.

Anything else is carried by the protocol as `{ type: 'file', url, name, mimeType }`
— a URL, not bytes — and the hub does not host files. So a document attachment
needs two things: a picker that offers the type, and somewhere to put it.

```js
init({
  agentId: 'bot-abc-123',
  accept: 'image/*,application/pdf,.docx,.xlsx',
  uploadUrl: 'https://your-api.example.com/api/agent/bot-abc-123/attachment',
});
```

`uploadUrl` receives `POST` as `multipart/form-data` with the file in a `file`
field, and answers `{ url, name?, mimeType? }` — or the same object under a
`data` key. The `token` given to `init` is forwarded as `Authorization`.

Widen `accept` without `uploadUrl` and the widget says so next to the input
rather than dropping the file quietly. Limits stay as they were: 5 attachments per message, 10 MB each.

### Turning pictures off

```js
init({
  agentId: 'bot-abc-123',
  enableImages: false,
});
```

This closes both directions. The picker disappears, and pasted or dropped
images are refused rather than silently ignored — and the handshake stops
advertising `images`, which is what tells the agent not to answer with one.
Hiding the picker alone would only cover the visitor's side.

Documents are unaffected: with `uploadUrl` configured the picker stays for
them, so `enableImages: false` plus an upload endpoint gives a
documents-only widget.

`themeVars` covers the design tokens (colors, radius, shadow, etc.). To override the actual class rules (`.bridle__panel`, `.bridle__bubble`, ...), inject your own CSS into the shadow root via `customCss` or `stylesheets`:

```js
init({
  apiUrl: '…',
  agentId: '…',
  customCss: `
    .bridle__panel {
      border-radius: 5px;
      box-shadow: 0 2px 6px #00000029;
      border: 1px solid #C5D5FF;
    }
  `,
  stylesheets: ['/css/bridle-overrides.css'],
})
```

Drop-in equivalent:

```html
<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-agent-id="agent-abc-123"
  data-stylesheet="/css/bridle-overrides.css"
></script>
```

Both append `<style>` / `<link>` tags inside the shadow root, so cascade order puts your overrides after the component's own rules.

## Development

```bash
npm install
npm run dev      # Vite watch mode
npm run build    # Outputs dist/bridle.js (IIFE) + dist/bridle.mjs (ESM) + d.ts
```

## Bundle size

Approx. 80 kB gzipped (Vue runtime + socket.io-client + widget code, all inlined). The IIFE bundle is fully self-contained — embedders pay zero install cost.
