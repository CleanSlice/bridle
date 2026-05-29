# 05 · Welcome message

Pre-seed the first assistant bubble for visitors who land on an empty chat. Typing dots appear for a moment, then your message lands like the agent typed it. One-shot per session — closing and reopening does not re-trigger; existing transcripts skip it entirely.

## Snippet

```html
<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-agent-id="agent-abc-123"
  data-token="<jwt>"
  data-greeting="Hi! 👋 I can help you compare plans, schedule a demo, or open a support ticket. What are you here for?"
  data-greeting-delay="2500"
></script>
```

Programmatic form:

```ts
Bridle.init({
  apiUrl, agentId, token,
  greeting: 'Hi! 👋 What brings you here?',
  greetingDelay: 2500,
})
```

## Live demo

<BridleEmbed
  title="Welcome demo"
  greeting="Hi! I'm the Bridle demo agent. Drop a screenshot or ask me anything."
  :greeting-delay="2500"
/>

The chat above is mounted on every page load with a fresh transcript — refresh to see the greeting fire again.

## Behavior

| Condition | Result |
|-----------|--------|
| Panel open + connected + `messages.length === 0` | Typing indicator for `greetingDelay` ms, then bubble appears |
| Returning visitor — transcript replay brought history | Greeting is **suppressed** (transcript wins) |
| User types and sends a message during the delay | Greeting **cancelled**, their turn is first |
| Close → open → close → open | Fires **once per session**; reopening doesn't re-trigger |
| Reconnect (`apiUrl` / `agentId` / `token` / `prompt` change) | Flag resets along with the transcript — greeting is available again |
| `greetingDelay: 0` | No typing indicator — bubble appears immediately |

Markdown is rendered the same as any assistant message — use `**bold**`, links, lists.

## Combine with `data-prompt`

Tune the greeting per page by pairing it with [Page Context](/embed/context):

```html
<!-- /pricing -->
<script ...
  data-prompt="Section: pricing. Visitor is comparing plans."
  data-greeting="Looking at plans? I can walk you through what's different between Pro and Team."
></script>

<!-- /docs/embed -->
<script ...
  data-prompt="Section: docs/embed. Reading integration guides."
  data-greeting="Reading the embed docs? Ask me about CSP, theming, or auth — I'll link the right page."
></script>
```

## When NOT to use it

- **Persistent greeting** — already handled. The flag only fires on an empty transcript, so returning users with history never see it. No extra config needed.
- **Multi-step onboarding** — `greeting` is one bubble. For an interactive flow, let the agent runtime react to a synthetic "user opened the chat" event you fire from `onReady`.
- **As a substitute for the agent's actual system prompt** — keep instructions on the agent side, where they don't leak through `data-*`.

## Related

- [Page Context](/embed/context) — `data-prompt` for handshake-time visitor context.
- [Script Tag → Welcome message](/embed/script-tag#welcome-message) — full reference and behavior notes.
