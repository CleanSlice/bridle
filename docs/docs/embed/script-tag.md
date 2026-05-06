# Script Tag

The drop-in path. One `<script>` tag, zero build step, works on any HTML page — WordPress, Webflow, Shopify, plain HTML, you name it.

## Minimal embed

```html
<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-api-url="https://your-hub.example.com"
  data-bot-id="bot-abc-123"
  data-token="<jwt>"
></script>
```

When the script loads, it auto-registers a `<bridle-chat>` Custom Element and mounts a floating chat bubble in the bottom-right corner of the page.

## All `data-*` attributes

| Attribute | Default | Description |
|-----------|---------|-------------|
| `data-bot-id` | **required** | Bot identifier registered on the hub |
| `data-token` | **required** | JWT for browser auth — signed by your backend |
| `data-api-url` | inferred from script's origin | Hub URL, e.g. `https://hub.example.com` |
| `data-mode` | `floating` | `floating` (FAB in corner) or `inline` (inside `data-mount`) |
| `data-mount` | `<body>` | CSS selector for inline mode, e.g. `#chat-container` |
| `data-title` | `Agent Chat` | Header text |
| `data-placeholder` | `Type a message...` | Input placeholder |

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
| `/sdk/v1.js` | Tracks the latest **1.x** release. Safe for most production embeds. |
| `/sdk/v1.2.3.js` | Pinned exact version. Cached forever. Use this for predictable rollouts. |

For production sites we recommend `/sdk/v1.js` — you get patches automatically without breaking changes.

## Inline mode

Mount the chat inside a specific container instead of floating:

```html
<div id="support-chat" style="height: 600px; max-width: 400px;"></div>

<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-api-url="https://your-hub.example.com"
  data-bot-id="bot-abc-123"
  data-token="<jwt>"
  data-mode="inline"
  data-mount="#support-chat"
></script>
```

In inline mode, the chat fills its container. Set the height/width on the parent via CSS.

## Programmatic API on `window.Bridle`

The script exposes a global object so you can also drive the widget from your own code:

```html
<script src="https://bridle.cleanslice.org/sdk/latest.js"></script>
<script>
  const chat = window.Bridle.init({
    apiUrl: 'https://your-hub.example.com',
    botId: 'bot-abc-123',
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

When the script loads without `data-bot-id`, it skips the auto-mount and waits for `Bridle.init({...})` to be called manually.

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
