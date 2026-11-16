# Bridle Agent Client (Runtime)

This is a reference copy. The production version lives in the [CleanSlice Runtime](https://github.com/CleanSlice/runtime) repo at:

```
runtime/src/slices/setup/channel/data/repositories/bridle/bridle.repository.ts
```

The runtime version imports from the channel domain (`IChannelGateway`, `Message`, `buildMessage`) and converts between wire `BridlePart[]` and runtime `MessagePart[]`. This standalone copy keeps bridle self-contained with its own interfaces.

## When to use which

| Version | Use when |
|---------|----------|
| `runtime/` (this folder) | Integrating bridle into a non-CleanSlice project |
| Runtime repo copy | Already using the CleanSlice runtime with the channel system |

## Protocol

See [PROTOCOL.md](../docs/PROTOCOL.md) for the wire format, event schemas, and streaming model.

## Showing your work

An agent that reasons before answering can say so out loud. `note()` sends one
line of that reasoning; the browser collects the notes of a turn into a single
collapsible **work log** above the answer, never into the answer itself.

```ts
await channel.note(clientId, 'The user wants their order status — I need the id first.')
await channel.note(clientId, '→ lookupOrder', 'tool')
await channel.streamSend(clientId, (onChunk) => llm.stream(onChunk))
```

Send notes between `typing` and the end of the stream: that window is what
marks them as notes even for receivers that ignore the `kind` field. Details in
[PROTOCOL.md § Notes](../docs/PROTOCOL.md#notes-agent-reasoning).

## Optional demo handlers (`bridle.demo.ts`)

Drop-in helpers that wire showcase flows onto your agent without boilerplate. Import only what you need.

```ts
import { BridleRepository } from './bridle.repository'
import { attachFormDemo }   from './bridle.demo'

const bridle = new BridleRepository(process.env.BRIDLE_URL)
attachFormDemo(bridle)          // gives the agent a working `/form` command
await bridle.start()
```

| Helper | What it does |
|--------|--------------|
| `attachFormDemo(bridle)` | Listens for `/form` and replies with a plan-picker `ui` part; acks the matching `ui_submit` with a confirmation. Capability-gated, falls back to text on non-Bridle channels. Used by the [06 · forms](https://bridle.cleanslice.org/examples/forms.html) demo page. |

Add new helpers to this file as more showcase flows land — same module, same pattern.
