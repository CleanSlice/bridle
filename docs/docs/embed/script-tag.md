# Script Tag

The drop-in path. One `<script>` tag, zero build step, works on any HTML page — WordPress, Webflow, Shopify, plain HTML, you name it.

## Minimal embed

```html
<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-api-url="https://your-hub.example.com"
  data-agent-id="agent-abc-123"
  data-token="<jwt>"
></script>
```

When the script loads, it auto-registers a `<bridle-chat>` Custom Element and mounts a floating chat bubble in the bottom-right corner of the page.

## All `data-*` attributes

| Attribute | Default | Description |
|-----------|---------|-------------|
| `data-agent-id` | **required** | Bot identifier registered on the hub |
| `data-token` | **required** | JWT for browser auth — signed by your backend |
| `data-api-url` | inferred from script's origin | Hub URL, e.g. `https://hub.example.com` |
| `data-mode` | `floating` | `floating` (FAB in corner) or `inline` (inside `data-mount`) |
| `data-mount` | `<body>` | CSS selector for inline mode, e.g. `#chat-container` |
| `data-title` | `Agent Chat` | Header text |
| `data-placeholder` | `Type a message...` | Input placeholder |
| `data-custom-css` | optional | Inline CSS injected into the shadow root — see [Theming › Overriding internal classes](/embed/theming#overriding-internal-classes) |
| `data-stylesheet` | optional | Stylesheet URL(s) loaded into the shadow root. Comma-separate for multiple files |
| `data-fab-icon` | optional | URL of an image to replace the FAB's built-in chat-bubble glyph (floating mode). See [Theming › Custom FAB icon](/embed/theming#custom-fab-icon) |
| `data-prompt` | optional | Free-form context string sent at handshake and forwarded to the agent on every message — page URL, user plan, locale, A/B cohort, etc. See [Page Context](/embed/context) |
| `data-greeting` | optional | Welcome message shown on the first open of an empty chat, after a typing-indicator delay. Markdown supported. See [Welcome message](#welcome-message) |
| `data-greeting-delay` | `3000` | Milliseconds of typing indicator before `data-greeting` appears. Set `0` to skip the delay |

## Choosing where to load the script from

Three options, pick what fits your CSP and ops:

```html
<!-- A. From this site (CleanSlice CDN) -->
<script src="https://bridle.cleanslice.org/sdk/latest.js" ...></script>

<!-- B. From your hub origin (zero extra domains, simplest CSP) -->
<script src="https://your-hub.example.com/sdk/latest.js" ...></script>

<!-- C. Public CDN mirror (jsDelivr / unpkg via npm) -->
<script src="https://cdn.jsdelivr.net/npm/@cleanslice/bridle@latest" ...></script>
```

When the SDK is loaded **from the same origin as your hub** (option B), `data-api-url` can be omitted — the SDK infers it from `document.currentScript.src`.

## Versioning

| URL | Behavior |
|-----|----------|
| `/sdk/latest.js` | Always tracks the latest build. Convenient, no caching guarantees. |
| `/sdk/v0.js` | Tracks the latest **0.x** release. Safe for most production embeds. |
| `/sdk/v0.4.1.js` | Pinned exact version. Cached forever. Use this for predictable rollouts. |

For production sites we recommend `/sdk/v0.js` — you get patches automatically without breaking changes.

## Inline mode

Mount the chat inside a specific container instead of floating:

```html
<div id="support-chat" style="height: 600px; max-width: 400px;"></div>

<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-api-url="https://your-hub.example.com"
  data-agent-id="agent-abc-123"
  data-token="<jwt>"
  data-mode="inline"
  data-mount="#support-chat"
></script>
```

In inline mode, the chat fills its container. Set the height/width on the parent via CSS.

## Welcome message

When the visitor opens the chat for the first time and there's no prior transcript, you can pre-seed an assistant bubble — typing dots appear for a moment, then the message fades in like the agent typed it.

```html
<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-agent-id="agent-abc-123"
  data-token="<jwt>"
  data-greeting="Hi! 👋 I can help you compare plans, schedule a demo, or open a support ticket. What are you here for?"
  data-greeting-delay="3000"
></script>
```

Programmatic equivalent:

```ts
init({
  apiUrl,
  agentId,
  token,
  greeting: "Hi! 👋 I can help you compare plans, schedule a demo, or open a support ticket. What are you here for?",
  greetingDelay: 3000,
})
```

### Behavior

- Fires **once** per session, when the panel is open + connected + transcript is empty.
- A typing indicator is shown for `greetingDelay` ms (default 3000). Set to `0` to skip the delay and have the message appear instantly.
- Suppressed if the transcript-replay races in with existing messages, or if the user types and sends something during the delay (their first turn wins).
- Markdown is rendered the same as any other assistant message — use `**bold**`, links, lists.

### When to use it

- **Onboarding hint** — tell the visitor what the bot can actually do, so they don't ask "what can you do?" first.
- **Section-specific intro** — combine with [`data-prompt`](/embed/context) so the greeting is tuned to the page (pricing vs. support vs. docs).
- **Off-hours notice** — "I'm a bot — for live support after 8pm, leave your email and we'll reply in the morning."

### When NOT to use it

- **Persistent greeting on every open** — if you want the same opener for returning visitors too, leave it as-is (it always fires on an empty transcript). Once the visitor sends a message and reloads, the transcript replay fills the panel and the greeting stays out of the way.
- **Multi-step onboarding** — `greeting` is one bubble. For an interactive flow, let the agent runtime handle it (the runtime can react to a synthetic "user opened the chat" event you fire from `onReady`).

## Programmatic API on `window.Bridle`

The script exposes a global object so you can also drive the widget from your own code:

```html
<script src="https://bridle.cleanslice.org/sdk/latest.js"></script>
<script>
  const chat = window.Bridle.init({
    apiUrl: 'https://your-hub.example.com',
    agentId: 'agent-abc-123',
    token: 'eyJhbG...',
    mount: '#chat',
    mode: 'inline',
  })

  // Later:
  chat.sendMessage('Hello')
  chat.open()
  chat.close()
  chat.destroy()
</script>
```

When the script loads without `data-agent-id`, it skips the auto-mount and waits for `Bridle.init({...})` to be called manually.

## CSP

The hub's origin must be allowed in `connect-src` (for the WebSocket and the transcript fetch) and the SDK's origin must be allowed in `script-src`:

```
Content-Security-Policy:
  script-src 'self' https://bridle.cleanslice.org;
  connect-src 'self' https://your-hub.example.com wss://your-hub.example.com;
```

## What gets injected

The SDK injects exactly one element: `<bridle-chat>`. It uses Shadow DOM, so:

- Your site's CSS does not affect the chat's appearance.
- The chat's CSS does not affect your site.
- DevTools shows a `#shadow-root (open)` you can inspect.

For brand colors, override [CSS custom properties](/embed/theming).
