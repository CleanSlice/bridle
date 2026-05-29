# Interactive UI parts

Bridle ≥ v0.12.0 lets agents render **forms inside chat bubbles** — radio groups, checkboxes, selects, text inputs — and receive the submitted values back as a regular user message. Everything rides on the existing `parts[]` channel; the hub is unchanged below the type layer.

This is **Bridle-only**. Other channels (Telegram, email) don't render forms, so agents must check the client's [capabilities](#capability-discovery) before emitting a `ui` part.

## Wire format

### Agent → Browser — `ui`

```ts
{
  type: 'ui',
  uiId: 'plan-2026-05',           // stable ID — must be set by the agent
  components: [
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
      default: false,
    },
  ],
  submit: { label: 'Continue' },   // optional — default: "Apply"
}
```

Mix `ui` parts freely with `text` / `image` in the same message — the SDK renders them in order inside the assistant bubble.

### Browser → Agent — `ui_submit`

When the visitor clicks Submit, the SDK sends a new user message containing exactly one `ui_submit` part:

```ts
{
  type: 'ui_submit',
  uiId: 'plan-2026-05',                            // echoes the original
  values: {
    plan: 'pro',
    newsletter: true,
  },
}
```

The text shorthand on this user message is a human-readable summary so transcripts and admin logs stay readable: `"Plan: pro · Send me weekly product updates: yes"`.

## Component reference

All components are objects with a `type` discriminator. Fields with `?` are optional.

| `type` | Fields |
|--------|--------|
| `heading` | `text` |
| `text` | `text` |
| `input` | `name`, `label?`, `placeholder?`, `required?`, `default?` |
| `textarea` | `name`, `label?`, `placeholder?`, `required?`, `default?` |
| `radio` | `name`, `label?`, `required?`, `default?`, `options: [{ value, label }]` |
| `checkbox` | `name`, `label`, `default?: boolean` |
| `checkbox-group` | `name`, `label?`, `required?`, `default?: string[]`, `options: [{ value, label }]` |
| `select` | `name`, `label?`, `placeholder?`, `required?`, `default?`, `options: [{ value, label }]` |

Values in `ui_submit.values`:
- `input` / `textarea` / `radio` / `select` → `string`
- `checkbox` → `boolean`
- `checkbox-group` → `string[]`

## `uiId` — round-trip identity

`uiId` is **required**. The agent picks it (e.g. `plan-2026-05`, `subscribe-flow-step1`, `uuid-...`) and uses it on `ui_submit` to match the answer to the question it asked. With multi-step or branching flows, this is the only thing keeping submissions from one form from colliding with another.

The SDK does no auto-generation. Pick one and stick with it.

## Capability discovery

The SDK advertises what part types it can render on the WebSocket handshake:

```
auth.capabilities = ['streaming', 'images', 'files', 'ui']
```

The hub forwards this to the agent on every message:

```ts
bridle.onMessage(async (msg) => {
  const canUi = msg.capabilities?.includes('ui') ?? false

  if (canUi) {
    await bridle.send(msg.from, 'Pick a plan', [
      buildUiForm([{ type: 'radio', name: 'plan', options: [...] }]),
    ])
  } else {
    // Fall back to plain text on Telegram / older SDKs.
    await bridle.send(msg.from, 'Reply with basic / pro / team to pick a plan.')
  }
})
```

Older SDK versions (≤ 0.11.0) and non-Bridle channels won't set `capabilities`. **Default to text** when the field is missing.

## Multi-step / branching

The SDK does not own the flow. After each `ui_submit` the runtime decides what to send next — another `ui` part, a confirmation message, a redirect link, whatever. Wire-level, there's nothing special about a "second" step.

```
agent: ui (uiId=step1, components=[plan]) ───────►
                                          ◄──── user: ui_submit (uiId=step1, values={plan:'pro'})
agent: ui (uiId=step2, components=[email]) ──────►
                                          ◄──── user: ui_submit (uiId=step2, values={email:'a@b'})
agent: text 'Thanks, you're all set!' ───────────►
```

## SDK behavior

- **Single submit.** Once Submit fires, the form disables itself and shows "Sent" — the visitor can't double-fire the same question.
- **Default values** populate the form on mount. `radio` / `select` defaults select the matching option; `checkbox` honors the boolean; `checkbox-group` accepts a `string[]`.
- **Required validation.** Missing `required` fields surface a single inline error above the submit button. Type coercion is automatic (checkbox → boolean, etc.).
- **Persistence.** Form state lives in the SDK; reloading the page restores message history but rendered forms come back in their **initial** (not submitted) state. If the agent already received and processed the `ui_submit`, it's the agent's job not to ask again.

## Trade-offs and limits

- **Closed component set.** Adding new components (date pickers, sliders, file inputs, repeating groups) requires an SDK release. JSON Schema is more flexible but heavier; we picked a closed micro-DSL deliberately.
- **No client-side conditional logic.** "Show field B only when A = pro" lives entirely on the agent side — emit a follow-up `ui` part after the first submit instead.
- **No partial submit / live preview.** Submit is the only event. If you want interactive previews, render a separate component flow.
- **Style only.** Forms can be themed via [`customCss`](/embed/theming#overriding-internal-classes) targeting `.bridle__ui`, `.bridle__ui-field`, `.bridle__ui-submit`, `.bridle__ui-choice`. CSS variables already drive the chrome.

## Themable classes

| Class | What it is |
|-------|------------|
| `.bridle__ui` | The form container |
| `.bridle__ui--submitted` | Modifier added once the form is sent (the SDK dims it) |
| `.bridle__ui-heading` | `{ type: 'heading' }` |
| `.bridle__ui-text` | `{ type: 'text' }` |
| `.bridle__ui-field` | Wrapper around every input/group |
| `.bridle__ui-label` | Field label / fieldset legend |
| `.bridle__ui-required` | The `*` marker after a required label |
| `.bridle__ui-input` / `.bridle__ui-textarea` / `.bridle__ui-select` | Form controls |
| `.bridle__ui-choice` | One radio / checkbox row |
| `.bridle__ui-fieldset` | Radio or checkbox-group wrapper |
| `.bridle__ui-error` | Validation error above the submit |
| `.bridle__ui-submit` | The Submit button |
| `.bridle__ui-summary` | User-side bubble showing the submitted values |

## See also

- [Examples → Interactive forms](/examples/forms) — cookbook walkthrough.
- [Message Parts](/protocol/parts) — full part-type reference.
- [Embed → Theming](/embed/theming) — `customCss` and CSS variables.
