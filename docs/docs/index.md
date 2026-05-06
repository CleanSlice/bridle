---
layout: home

hero:
  name: Bridle
  text: Embed AI chat in any site.
  tagline: One script tag connects your visitors to a streaming AI agent through a stateless WebSocket relay.
  actions:
    - theme: brand
      text: Quick Start
      link: /guide/quick-start
    - theme: alt
      text: View on GitHub
      link: https://github.com/CleanSlice/bridle

features:
  - icon: 🪄
    title: Drop-in script
    details: One <code>&lt;script&gt;</code> tag mounts a floating chat bubble. No build step, no framework, no styles to wire up.
  - icon: ⚡
    title: Streaming-first
    details: Messages stream token-by-token over WebSocket. Typing indicators, partial updates, and final commits — all built in.
  - icon: 🧩
    title: Three integration paths
    details: Script tag for any HTML page, NPM for Vite/Next/Webpack, and a headless client when you want to bring your own UI.
  - icon: 🎨
    title: Themable, isolated
    details: Shadow DOM keeps your styles in and the host site’s styles out. Override CSS variables to match your brand.
  - icon: 🔐
    title: JWT browser auth
    details: Browsers authenticate with a short-lived JWT you mint server-side. Per-bot isolation enforced on the hub.
  - icon: 🪶
    title: Stateless hub
    details: The hub holds no message history. Horizontal scaling is just spinning up more pods.
---

## At a glance

```html
<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-api-url="https://your-hub.example.com"
  data-bot-id="bot-abc-123"
  data-token="<jwt>"
></script>
```

That's the whole integration. A floating bubble appears in the bottom-right corner. When the user opens it, the SDK connects to your hub over WebSocket and streams the agent's responses live.

For programmatic control, an NPM package, or a headless client, see the [Quick Start](/guide/quick-start).
