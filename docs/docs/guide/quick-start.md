# Quick Start

Three steps from zero to a chat bubble that talks to your agent.

## Prerequisites

You need:

1. A running Bridle hub. See [Deploy → Hub](/deploy/hub) if you don't have one yet.
2. An agent runtime connected to the hub on a known `agentId`. See [Deploy → Runtime](/deploy/runtime).
3. An endpoint in your app that mints a short-lived JWT for the browser. The hub verifies the JWT — see [Authentication](/protocol/authentication) for the required claims.

## Step 1 — mint a token

In your backend, sign a JWT with the same secret your hub uses:

```js
import jwt from 'jsonwebtoken'

app.get('/api/bridle-token', (req, res) => {
  const token = jwt.sign(
    {
      sub: req.user.id,        // → used as clientId by the hub
      email: req.user.email,
      roles: [],               // include 'ADMIN' for admin features
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  )
  res.json({ token })
})
```

## Step 2 — embed the chat

The simplest path — drop one script tag into your HTML:

```html
<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-api-url="https://your-hub.example.com"
  data-agent-id="agent-abc-123"
  data-token="<jwt-from-step-1>"
></script>
```

If you can render the page server-side, embed the JWT directly in `data-token`. If your token has to be fetched from the client, use the [programmatic init](#programmatic-init) instead.

## Step 3 — open the chat

Reload the page. A floating bubble appears in the bottom-right corner. Click it. You're talking to your agent.

---

## Programmatic init

When you need to fetch the token from the client (SPA, dynamic auth):

```html
<div id="chat"></div>
<script type="module">
  import { init } from 'https://bridle.cleanslice.org/sdk/latest.mjs'

  const res = await fetch('/api/bridle-token')
  const { token } = await res.json()

  init({
    apiUrl: 'https://your-hub.example.com',
    agentId: 'agent-abc-123',
    token,                       // or a function for refresh
    mount: '#chat',
    mode: 'inline',              // embed inside #chat instead of floating
    title: 'Support',
    theme: { '--bridle-primary': '#0070f3' },
  })
</script>
```

## With a bundler (Vite, Next, Webpack)

```bash
bun add @cleanslice/bridle
# or: npm i / pnpm add / yarn add @cleanslice/bridle
```

```ts
import { init } from '@cleanslice/bridle'

init({
  apiUrl: import.meta.env.VITE_BRIDLE_URL,
  agentId: 'agent-abc-123',
  token: () => fetchJwt(),
  mount: '#chat',
})
```

## Headless — bring your own UI

If you don't want the built-in widget, use the `BridleClient` directly:

```ts
import { BridleClient } from '@cleanslice/bridle'

const client = new BridleClient({ apiUrl, agentId, token })

client.on('message', (m) => render(m.text))
client.on('stream', (m) => renderPartial(m.text))
client.on('stream_end', (m) => commit(m.text))

await client.connect()
client.send('Hello')
```

See [Headless Client](/embed/headless) for the full API.

---

## Where next

- [Embed → Script Tag](/embed/script-tag) — every supported `data-*` attribute
- [Embed → Theming](/embed/theming) — CSS variables and brand colors
- [Protocol → Streaming](/protocol/streaming) — what the wire actually carries
- [Deploy → Hub](/deploy/hub) — running the NestJS hub on your infrastructure
