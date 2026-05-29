// Opt-in demo handlers for `BridleRepository`. Pull these in from a ranch
// agent (or any runtime) to get working showcase flows without having to
// hand-roll the boilerplate. Each helper is idempotent — calling it
// registers a single `onMessage` listener and returns nothing; existing
// listeners keep working.

import {
  BridlePartTypes,
  buildUiForm,
  type IBridleMessageData,
  type IChannelGateway,
} from './bridle.repository'

/**
 * Wire a sample `/form` command into your agent so the embed-side demo
 * page at https://bridle.cleanslice.org/examples/forms.html (and the
 * 06 · forms section of bridle/example/index.html) renders a working
 * form end-to-end.
 *
 * Behavior:
 *  - On any incoming message whose text trims to `/form`, sends a plan-
 *    picker `ui` part — provided the client advertises the `ui` capability
 *    (Bridle SDK ≥ v0.12.0). Falls back to a plain-text instruction on
 *    Telegram, email, or older SDKs.
 *  - On any incoming `ui_submit` with `uiId === 'plan-demo'`, replies with
 *    a confirmation that quotes what the visitor picked. Doesn't mutate
 *    any state — strictly an echo for the demo.
 *
 * Usage in a ranch agent:
 *
 *   import { BridleRepository } from './channels/bridle.repository'
 *   import { attachFormDemo }   from './channels/bridle.demo'
 *
 *   const bridle = new BridleRepository(process.env.BRIDLE_URL)
 *   attachFormDemo(bridle)
 *   // ...register your other onMessage handlers as usual; the demo helper
 *   //    short-circuits only when the trigger conditions match, so it
 *   //    composes cleanly with the agent's main flow.
 *   await bridle.start()
 *
 * If you'd rather not run the showcase on a production agent, skip the
 * import — nothing else in `bridle/runtime/` depends on this file.
 */
export function attachFormDemo(bridle: IChannelGateway): void {
  bridle.onMessage(async (msg: IBridleMessageData) => {
    // 1) ui_submit ack — has to come BEFORE the text trigger check because
    //    submit messages carry no text, just the structured part.
    for (const part of msg.parts) {
      if (part.type !== BridlePartTypes.UiSubmit) continue
      if (part.uiId !== 'plan-demo') continue
      const values = part.values as Record<string, unknown>
      const plan = String(values.plan ?? 'unknown')
      const newsletter = values.newsletter === true
      await bridle.send(
        msg.from,
        `Got it — you picked **${plan}**${newsletter ? ', newsletter on' : ''}. ` +
          `(This is a demo; nothing actually changed.)`,
      )
      return
    }

    // 2) /form trigger — case-insensitive, ignores leading/trailing whitespace
    if (msg.text?.trim().toLowerCase() !== '/form') return

    // 3) Capability gate — bail to text on channels that can't render forms.
    if (!msg.capabilities?.includes('ui')) {
      await bridle.send(
        msg.from,
        "Reply with one of: `basic`, `pro`, `team` (your client doesn't support inline forms).",
      )
      return
    }

    const form = buildUiForm(
      [
        { type: 'heading', text: 'Pick a plan' },
        { type: 'text', text: 'You can change this later in account settings.' },
        {
          type: 'radio',
          name: 'plan',
          label: 'Plan',
          required: true,
          default: 'basic',
          options: [
            { value: 'basic', label: 'Basic — $0 / mo' },
            { value: 'pro', label: 'Pro — $10 / mo' },
            { value: 'team', label: 'Team — $30 / mo' },
          ],
        },
        {
          type: 'checkbox',
          name: 'newsletter',
          label: 'Send me weekly product updates',
        },
      ],
      { uiId: 'plan-demo', submitLabel: 'Continue' },
    )

    await bridle.send(msg.from, 'Pick a plan to continue:', [
      { type: BridlePartTypes.Text, text: 'Pick a plan to continue:' },
      form,
    ])
  })
}
