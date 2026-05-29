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

## Optional knobs

Everything below works on the script tag with **zero extra integration code** — pure `data-*` attributes:

| Attribute | What it does | Reference |
|-----------|--------------|-----------|
| `data-greeting` | Pre-seeds the first assistant bubble after a typing-indicator delay on an empty chat | [Welcome message](/examples/welcome) |
| `data-greeting-delay` | Milliseconds before the greeting appears (default `3000`) | — |
| `data-empty-avatar` / `data-empty-title` / `data-empty-subtitle` | Avatar + headline + sub-line shown on the empty-state screen | [Empty state](/examples/empty-state) |
| `data-suggestions` | Pipe-separated suggestion chips on the empty state — click to send | — |
| `data-prompt` | Free-form context forwarded to the agent on every message — page URL, plan, locale, A/B cohort | [Page Context](/embed/context) |
| `data-fab-icon` | URL of an image to replace the FAB's built-in glyph | [Theming › Custom FAB icon](/embed/theming#custom-fab-icon) |
| `data-custom-css` | Inline CSS injected into the shadow root to restyle internal classes | [Theming › Overriding internal classes](/embed/theming#overriding-internal-classes) |
| `data-stylesheet` | One or more `<link>` URLs loaded into the shadow root | — |
| `data-color-mode` | `auto` / `light` / `dark` — overrides the page's color scheme | — |
| `data-theme` | `default` / `cleanslice` — built-in palette | — |

**Image attachments** (paperclip / drag / paste) and **mobile full-bleed panel** are on by default — no flags. See [03 · Styles](/examples/styles) for theming the attachment strip.

## What the agent can render

Beyond plain text, the SDK renders rich `parts[]` the agent runtime sends back. None of this needs new integration code — just emit the right part type:

| Part type | Renders as | Use it for |
|-----------|-----------|------------|
| `text` | Markdown bubble (lists, code, links, tables) | The default reply. |
| `image` | Inline image inside the bubble | Screenshots, generated charts, photo replies. |
| `ui` | A form (radio / checkbox / select / input / textarea) right inside the bubble, with one-shot Submit | Onboarding flows, collecting structured info mid-conversation — see [07 · Interactive forms](/examples/forms). |

The SDK advertises its capabilities (`['streaming', 'images', 'files', 'ui']`) on the WebSocket handshake; the hub forwards them on every message so the agent runtime can decide which part types it's safe to emit for this peer. Older SDKs and non-Bridle channels (Telegram, email) just don't get a `capabilities` field — agents should fall back to text when it's missing.

A bulkier example with all the knobs at once:

```html
<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-api-url="https://hub.example.com"
  data-agent-id="agent-31a6fbd1-…"
  data-token="<jwt>"
  data-greeting="Hi! 👋 What brings you here?"
  data-greeting-delay="2500"
  data-prompt="URL: https://shop.example.com/pricing · Plan: free"
  data-fab-icon="/icons/chat.svg"
  data-theme="cleanslice"
  data-color-mode="auto"
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
