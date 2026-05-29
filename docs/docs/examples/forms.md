# 07 · Interactive forms

The agent renders a form **inside its chat bubble** — radio groups, checkboxes, selects, text inputs — and gets the answers back as a normal user turn. Wire protocol: a new `ui` part agent→browser and `ui_submit` browser→agent. Full reference: [Protocol → Interactive UI](/protocol/ui).

Bridle-only feature. Telegram, email, and pre-v0.12 SDK clients don't render it — see [capability discovery](#capability-discovery) below.

## Drop-in helper for the showcase

If you just want the `/form` demo working end-to-end (the same flow the [embed example page](https://github.com/CleanSlice/bridle/blob/main/example/index.html) and its trigger button use), `bridle/runtime/` ships a one-line opt-in:

```ts
import { BridleRepository } from './channels/bridle.repository'
import { attachFormDemo }   from './channels/bridle.demo'

const bridle = new BridleRepository(process.env.BRIDLE_URL)
attachFormDemo(bridle)          // wires `/form` + ui_submit ack
await bridle.start()
```

That's enough to make any Bridle-connected embed page render the plan-picker form when the visitor sends `/form`. Below is the same code expanded inline if you want to write your own variants.

## Agent code

Build the form on the runtime side and emit it as one of the `parts[]` of an assistant message:

```ts
import { buildUiForm, BridlePartTypes } from '@cleanslice/bridle/runtime'

bridle.onMessage(async (msg) => {
  if (!msg.capabilities?.includes('ui')) {
    // Fallback for Telegram, older SDKs, etc.
    await bridle.send(msg.from, 'Reply with: basic, pro, or team')
    return
  }

  const form = buildUiForm(
    [
      { type: 'heading', text: 'Pick a plan' },
      { type: 'text',    text: 'You can change this later in account settings.' },
      {
        type: 'radio',
        name: 'plan',
        label: 'Plan',
        required: true,
        default: 'basic',
        options: [
          { value: 'basic', label: 'Basic — $0 / mo' },
          { value: 'pro',   label: 'Pro — $10 / mo' },
          { value: 'team',  label: 'Team — $30 / mo' },
        ],
      },
      {
        type: 'checkbox',
        name: 'newsletter',
        label: 'Send me weekly product updates',
      },
    ],
    { uiId: 'plan-2026-05', submitLabel: 'Continue' },
  )

  await bridle.send(msg.from, "Quick one before we get you set up:", [
    { type: BridlePartTypes.Text, text: "Quick one before we get you set up:" },
    form,
  ])
})
```

The next `bridle.onMessage` for the same client will carry the answers:

```ts
bridle.onMessage(async (msg) => {
  for (const part of msg.parts) {
    if (part.type !== 'ui_submit') continue
    if (part.uiId === 'plan-2026-05') {
      const { plan, newsletter } = part.values
      await provisionAccount({ plan: String(plan), newsletter: !!newsletter })
      await bridle.send(msg.from, `Done — your ${plan} plan is set up.`)
    }
  }
})
```

## What the visitor sees

A bordered card slides into the assistant bubble with your fields and a Submit button. Click Submit:

1. Inline validation runs — required fields raise an inline error.
2. The form disables itself (one-shot — no double submit).
3. A user-side summary bubble appears in the transcript: `Plan: pro · Send me weekly product updates: yes`.
4. The agent gets a `ui_submit` part on its next `onMessage`.

## Capability discovery

Bridle SDK sends `auth.capabilities: ['streaming', 'images', 'files', 'ui']` on the WebSocket handshake. The hub forwards it on every incoming message:

```ts
bridle.onMessage(async (msg) => {
  msg.capabilities  // string[] | undefined
})
```

Always guard with `msg.capabilities?.includes('ui')` before emitting `ui` parts. Older SDKs (≤ 0.11.0) and non-Bridle channels won't set it — assume **text only** when missing.

## Component cheat sheet

| Need | Component |
|------|-----------|
| Section title | `heading` |
| Help text under the title | `text` |
| Short free-form answer | `input` |
| Long free-form answer | `textarea` |
| Pick exactly one | `radio` |
| Yes / no | `checkbox` |
| Pick multiple | `checkbox-group` |
| Long pick-one list | `select` |

Full field reference: [Protocol → Component reference](/protocol/ui#component-reference).

## Tips

- **Always set `uiId`.** Use a stable string per flow step (`plan-pick`, `email-collect`, `onboarding-step3`). The agent uses it on `ui_submit` to know which form was answered.
- **Keep forms short.** 3–6 fields fit cleanly in a bubble; more starts to look like a settings page. For long flows, split into multi-step (one form per agent message).
- **No conditional fields client-side.** "Show B when A = pro" — emit B as a follow-up `ui` after the first submit.
- **Theming.** Style via [`customCss`](/embed/theming#overriding-internal-classes) targeting `.bridle__ui`, `.bridle__ui-submit`, etc. Full class list in [Protocol → Themable classes](/protocol/ui#themable-classes).

## Related

- [Protocol → Interactive UI](/protocol/ui) — wire format and behavior.
- [Welcome message](/examples/welcome) — for a pre-seeded assistant turn.
- [Empty state with suggestions](/examples/empty-state) — for pre-conversation prompts (different mechanism: chips fire text, forms collect structured answers).
