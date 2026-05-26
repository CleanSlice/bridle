# 01 · Basic

The shortest possible integration: one `<script>` tag with `data-*` attributes. SDK reads its own dataset, registers the Custom Element, and mounts a floating chat bubble in the corner of the page. Your Ranch API key stays on the server — only a short-lived JWT reaches the browser via `data-token`.

## Snippet

```html
<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-api-url="https://hub.example.com"
  data-agent-id="agent-31a6fbd1-…"
  data-token="<jwt>"
></script>
```

## What this does

| Step | Result |
|------|--------|
| Script loads | IIFE runs, sets `window.Bridle = { init, BridleClient, … }` |
| Auto-mount | Reads `data-agent-id` / `data-token` / `data-api-url` from its own script tag |
| Custom Element | `<bridle-chat>` registered once, instantiated in the DOM |
| Connection | WebSocket opened to `apiUrl/ws/client` with the JWT |
| UI | Floating FAB renders bottom-right; click to open the panel |

## Live demo

<BridleEmbed title="Basic demo" />

## When to use it

- Static sites — WordPress, Webflow, Shopify, plain HTML.
- You can render the JWT server-side into the markup (template engine, SSR).
- Default chat position (floating) works for your layout.

## Next

If the JWT must be fetched at runtime, or you need more than one widget on the page, switch to [Inline](/examples/inline) or [Authenticator](/examples/authenticator).
