# Page Context (`data-prompt`)

Bridle lets the integrator attach a free-form string at handshake time that the hub forwards to the agent runtime on **every** incoming message. Use it for context the agent should know about the visitor or the page they're on — current URL, locale, plan tier, A/B cohort, whatever your runtime can act on.

Set it once when the SDK mounts. It stays constant for the lifetime of the WebSocket; reconnecting (page reload, network blip) re-sends it from the dataset.

## Script tag

```html
<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-agent-id="agent-abc-123"
  data-token="<jwt>"
  data-prompt="Page: /pricing · User plan: free · Locale: en-US"
></script>
```

## Programmatic — `init()`

```ts
import { init } from '@cleanslice/bridle'

init({
  apiUrl,
  agentId,
  token,
  prompt: `Page: ${location.pathname} · Plan: ${user.plan} · Locale: ${navigator.language}`,
})
```

## Headless — `BridleClient`

```ts
import { BridleClient } from '@cleanslice/bridle'

const client = new BridleClient({
  apiUrl,
  agentId,
  token,
  prompt: JSON.stringify({ url: location.href, plan: user.plan, locale: navigator.language }),
})
```

## How the agent sees it

The hub forwards `prompt` on every `message` it routes to the agent runtime. In the runtime channel handler, it arrives next to `text` and `parts`:

```ts
bridle.onMessage(async (msg) => {
  // msg.prompt is exactly what the embed sent at handshake.
  // Treat it as untrusted user input — it came from the browser.
  const context = msg.prompt ?? ''

  await llm.complete({
    system: `You are a support agent.\n\nVisitor context:\n${context}`,
    user: msg.text,
  })
})
```

How you fold it in is up to the runtime — system prompt, retrieval filter, tool call argument, log line, anything.

## Examples

### Page URL + user metadata

The most common use — tell the agent where the visitor is and who they are:

```html
<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-agent-id="support-agent"
  data-token="<jwt>"
  data-prompt="URL: https://shop.example.com/products/widget-x · Plan: pro · Joined: 2024-03"
></script>
```

For more structured data, ship JSON and parse on the agent side:

```ts
init({
  apiUrl, agentId, token,
  prompt: JSON.stringify({
    url: location.href,
    referrer: document.referrer || null,
    plan: user.plan,
    locale: navigator.language,
    accountAgeDays: daysSince(user.createdAt),
  }),
})
```

### Per-page chatbot scoping

Same agent, different page = different context. Useful when one bot answers across the whole site but should bias toward the current section:

```ts
// /docs/* page
init({ apiUrl, agentId, token, prompt: 'Section: docs. Bias answers toward documentation links.' })

// /pricing page
init({ apiUrl, agentId, token, prompt: 'Section: pricing. Visitor is comparing plans — emphasize differences.' })
```

### A/B experiment cohort

```ts
init({
  apiUrl, agentId, token,
  prompt: `Experiment: chat-onboarding-v2 · Variant: ${cohort}`,
})
```

### Multi-tenant brand context

If you embed the same agent on several customers' sites:

```html
<!-- on acme.com -->
<script
  src=".../sdk/latest.js"
  data-agent-id="universal-helper"
  data-token="<jwt>"
  data-prompt="Tenant: acme · Brand voice: formal · Product line: industrial sealants"
></script>

<!-- on widgets-inc.com -->
<script
  src=".../sdk/latest.js"
  data-agent-id="universal-helper"
  data-token="<jwt>"
  data-prompt="Tenant: widgets-inc · Brand voice: playful · Product line: novelty mugs"
></script>
```

The agent reads `msg.prompt` and switches its system prompt or knowledge-base namespace accordingly.

## Practical limits

- **Size**: the value rides in the Socket.IO handshake (`auth.prompt`). Keep it under a few KB — anything larger is a smell, and very large payloads can be rejected by reverse proxies on the hub.
- **Lifetime**: set once at connect. To update, you need to reconnect — either trigger a fresh `init()` or change `data-token` / `data-agent-id` so the underlying watcher rebinds the client.
- **Trust**: it comes from the browser. The agent should treat it as **user-controlled input**, not a server claim. Anything authoritative (user id, role, entitlements) belongs in the JWT (`sub`, `roles`) — those are signed and the hub verifies them. Use `data-prompt` for hints, not for auth decisions.
- **PII**: `prompt` is forwarded verbatim through the hub and persists in agent logs. Don't put secrets, tokens, or anything you wouldn't write to a log file.

## When NOT to use it

- **Per-message context** — `data-prompt` is set once at handshake. If the context changes between messages, send it as part of the user message text instead, or reconnect.
- **Authentication / authorization** — use the JWT (`sub`, `email`, `roles`). The hub validates it; the browser can't lie about its identity once signed.
- **Large knowledge** — don't dump a 50 KB system prompt here. Keep that on the agent side; use `prompt` for the small contextual hint.

## Related

- [Authentication](/protocol/authentication) — JWT claims the hub verifies (separate from this contextual prompt).
- [Script Tag attributes](/embed/script-tag) — full list of `data-*` options.
- [Headless Client](/embed/headless) — `BridleClient` accepts the same `prompt` option.
