# 06 · Empty state with suggestions

Replace the default "Start a conversation" placeholder with an onboarding panel — agent avatar, headline, sub-line, and clickable suggestion chips. Click a chip and it sends as a normal user message; the whole block disappears the moment the conversation begins.

## Snippet

```html
<script
  src="https://bridle.cleanslice.org/sdk/latest.js"
  data-agent-id="agent-abc-123"
  data-token="<jwt>"
  data-empty-avatar="/avatars/support-agent.png"
  data-empty-title="How can I help?"
  data-empty-subtitle="I can compare plans, schedule a demo, or open a ticket."
  data-suggestions="Compare plans|Book a demo|Open a support ticket"
></script>
```

Programmatic form:

```ts
Bridle.init({
  apiUrl, agentId, token,
  emptyAvatar: '/avatars/support-agent.png',
  emptyTitle: 'How can I help?',
  emptySubtitle: 'I can compare plans, schedule a demo, or open a ticket.',
  suggestions: ['Compare plans', 'Book a demo', 'Open a support ticket'],
})
```

## Live demo

<BridleEmbed
  title="Welcome desk"
  empty-avatar="https://bridle.cleanslice.org/logo.svg"
  empty-title="How can I help?"
  empty-subtitle="Ask me anything about Bridle, or pick one of the prompts below."
  :suggestions="['How do I embed Bridle?', 'How does theming work?', 'What does data-prompt do?']"
/>

Click a chip — it sends as a user message, the panel switches to the live conversation, and the empty state stays out of the way.

## Behavior

| Condition | Result |
|-----------|--------|
| `messages.length === 0` and not typing | Empty state visible |
| Agent starts replying (`isTyping`) | Empty state hidden (chips don't flash next to a streaming reply) |
| User sends anything — text, image, or a chip | Empty state hidden — conversation begins |
| WebSocket not open | Chips disabled — visitors don't fire into a closed connection |
| All four fields unset | Legacy single-line "Start a conversation" copy |

## Combine with `greeting` and `prompt`

| Field | Job |
|-------|-----|
| `emptyAvatar` / `emptyTitle` / `emptySubtitle` / `suggestions` | What the **visitor** sees in an empty chat. Static content. |
| `greeting` / `greetingDelay` | What the **agent** "says" once typing dots clear. Static, one-shot per session. |
| `prompt` | What the **agent runtime** receives at handshake. Hidden from the visitor. Drives the agent's reasoning. |

Used together, they tell a coherent story to both sides:

```ts
Bridle.init({
  apiUrl, agentId, token,

  // Visitor sees:
  emptyAvatar: '/avatars/support-agent.png',
  emptyTitle: 'How can I help?',
  emptySubtitle: 'Ask anything about your subscription.',
  suggestions: ['Upgrade my plan', 'See past invoices', 'Cancel my account'],

  // Then the agent "introduces itself" once they open the panel:
  greeting: "Hi! I'm here for your subscription questions. Heads-up: cancellations are processed at the end of the billing cycle.",
  greetingDelay: 2000,

  // Background context for the runtime (not shown to visitor):
  prompt: 'Section: account/billing · Plan: pro · Renews: 2026-07-12',
})
```

## Tips

- **Keep chip text short** — chip text becomes the entire user message. "Pricing?" not "Could you walk me through your pricing model?". Long chips become long user turns in the transcript.
- **3–5 chips max** — more than that and the empty state grows tall enough to push the input below the fold on mobile.
- **Avatar at ≥56px** — the panel renders it as a 56×56 circle. Smaller sources scale up and look fuzzy.
- **Style the chip itself** via [`customCss`](/embed/theming#overriding-internal-classes) targeting `.bridle__suggestion` — see the recipe in [03 · Styles](/examples/styles#styling-image-attachments) (same approach).

## Related

- [Welcome message](/examples/welcome) — what the agent says.
- [Page Context](/embed/context) — what the agent runtime knows.
- [Script Tag → Empty state](/embed/script-tag#empty-state) — full reference.
