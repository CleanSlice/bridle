# @cleanslice/bridle-sdk

Embeddable webchat for [Bridle](https://bridle.cleanslice.org). One Web Component, three integration paths: drop-in `<script>`, npm + bundler, or headless client.

## Drop-in script (no build step)

```html
<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-api-url="https://your-hub.example.com"
  data-bot-id="bot-abc-123"
  data-token="<jwt>"
></script>
```

The script auto-mounts a floating chat bubble in the bottom-right corner. If the SDK is served from your hub origin, `data-api-url` can be omitted — it's inferred from the script's URL.

### Available `data-*` attributes

| Attribute | Default | Description |
|-----------|---------|-------------|
| `data-bot-id` | required | Bot identifier registered on the hub |
| `data-token` | required | JWT for browser auth |
| `data-api-url` | inferred | Hub origin |
| `data-mode` | `floating` | `floating` (FAB) or `inline` (mounted inside `data-mount`) |
| `data-mount` | `<body>` | CSS selector for inline mode |
| `data-title` | `Agent Chat` | Header text |
| `data-placeholder` | `Type a message...` | Input placeholder |

## Programmatic init

```js
import { init } from '@cleanslice/bridle-sdk'

const chat = init({
  apiUrl: 'https://your-hub.example.com',
  botId: 'bot-abc-123',
  token: () => fetchJwt(),     // string OR async function for refresh
  mount: '#chat',              // CSS selector or HTMLElement
  mode: 'inline',
  title: 'Support',
  theme: { '--bridle-primary': '#0070f3' },
  onReady: () => {},
  onMessage: (msg) => console.log(msg.text),
  onError: (err) => console.error(err),
})

chat.sendMessage('Hi!')
chat.open()
chat.close()
chat.destroy()
```

## Headless client (no UI)

```js
import { BridleClient } from '@cleanslice/bridle-sdk'

const client = new BridleClient({
  apiUrl: 'https://your-hub.example.com',
  botId: 'bot-abc-123',
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

## Development

```bash
npm install
npm run dev      # Vite watch mode
npm run build    # Outputs dist/bridle.js (IIFE) + dist/bridle.mjs (ESM) + d.ts
```

## Bundle size

Approx. 80 kB gzipped (Vue runtime + socket.io-client + widget code, all inlined). The IIFE bundle is fully self-contained — embedders pay zero install cost.
