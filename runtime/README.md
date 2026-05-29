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
