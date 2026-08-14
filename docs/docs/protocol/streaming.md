# Streaming

Streaming is how the agent's response appears word-by-word in the chat instead of arriving all at once after a long pause. Bridle's streaming model is intentionally simple — agents emit accumulated text, the SDK replaces what's rendered, the final commit wins.

## The events

Three WebSocket events form a streaming response:

```
typing       → optional, "agent is thinking" indicator
stream       → partial text, accumulated (not delta)
stream_end   → final text, identical to last stream payload
```

Plus the non-streaming alternative:

```
typing       → optional
message      → final text in one shot
```

Agents may stream some responses and not others — quick canned replies, tool-call results, etc., often skip the stream and use `message` directly. Always handle both.

## Accumulated text vs deltas

Bridle sends **accumulated text** on each `stream` event, not deltas. The full text-so-far is on the wire every time:

```
stream  { messageId: 'm-1', text: 'Hello' }
stream  { messageId: 'm-1', text: 'Hello, how' }
stream  { messageId: 'm-1', text: 'Hello, how can' }
stream  { messageId: 'm-1', text: 'Hello, how can I help?' }
stream_end  { messageId: 'm-1', text: 'Hello, how can I help?' }
```

The client just replaces the rendered text on each event:

```ts
client.on('stream', (m) => {
  document.querySelector(`#msg-${m.id}`).textContent = m.text
})
```

**Why accumulated, not deltas?**

- Simpler client logic — no string concatenation, no missed-chunk desync.
- Resilient to dropped events: a missed packet doesn't corrupt the rendered state. The next `stream` brings the client back in sync.
- The trade-off is bandwidth — 200 stream events of a 500-token reply send ~100 KB total instead of ~3 KB. In practice this is fine for chat, and dramatically simpler.

## Batch interval

The agent runtime batches stream events at **100ms intervals**. Token-by-token raw output from an LLM (often 30+ tokens/sec) collapses to 10 stream events per second over the wire. Tunable in the runtime if you need it tighter or looser.

## Implementation in the agent

The runtime ships a `streamSend` helper that handles the batching and final emit for you:

```ts
import { BridleRepository } from 'bridle/runtime'

const bridle = new BridleRepository(process.env.BRIDLE_URL!)

bridle.onMessage(async (msg) => {
  await bridle.streamSend(msg.from, async (onChunk) => {
    let accumulated = ''
    for await (const token of llmStream) {
      accumulated += token
      onChunk(accumulated)         // accumulated, not delta
    }
    return accumulated             // final text
  })
})

await bridle.start()
```

The streamer function gets an `onChunk` callback. Call it as often as you want with the **accumulated text** so far. The runtime takes care of:

- Sending an initial `typing` event.
- Batching `onChunk` calls into `stream` events at 100ms.
- Emitting the final `stream_end` when the streamer resolves.

## Implementation on the client

If you use the [embedded widget](/embed/script-tag), streaming works out of the box. If you use the [headless client](/embed/headless):

```ts
client.on('stream', (m) => {
  // Replace whatever you've rendered for m.id
  upsertMessage({ ...m, streaming: true })
})

client.on('stream_end', (m) => {
  // Final, mark complete
  upsertMessage({ ...m, streaming: false })
})

client.on('message', (m) => {
  // Non-streaming response
  upsertMessage(m)
})
```

Treat all three (`stream`, `stream_end`, `message`) as the same kind of update — the only difference is whether more is coming.

## Stream parts

`stream` and `stream_end` events also carry `parts`. The runtime sets the parts to a single text part containing the accumulated text:

```ts
// Hub → Browser
{
  type: 'stream',
  messageId: 'm-1',
  text: 'Hello, how',
  parts: [{ type: 'text', text: 'Hello, how' }],
  ts: 1746700000000,
}
```

This means the same client code that handles `parts[]` for non-streaming messages works for streams too — no special-casing.

## Thinking events

While the agent works with tools between text outputs, the chat would otherwise sit silent. Two mechanisms cover that window:

1. **Early `typing`.** The runtime emits `typing` at turn start and again before each tool batch — every client (including older SDKs) shows its thinking indicator through the whole generation, not just the final response.
2. **`thinking` events** — a live, Rovo-style timeline of what the agent is doing, rendered by capable clients as named, expandable steps above the incoming answer.

```
thinking  { clientId, turnId, step: { id, label, detail?, state }, ts }   // step update
thinking  { clientId, turnId, done: true, ts }                            // turn complete
```

- `turnId` groups every event of one agent turn (minted per run).
- `step.state` is `'active'` before the work starts and `'done'` (same `step.id`, updated in place) when it finishes.
- `step.label` is a humanized, visitor-safe name (e.g. `"Search knowledge base"`); `step.detail` is optional reasoning prose (markdown). **Never put raw tool params or prompts here** — unlike `debug`, this event is relayed to regular visitors, not admin-gated.
- The terminal `done: true` event closes the timeline; the widget collapses the block into a re-expandable summary row.

### Capability gating

The SDK (≥ v0.15.0) advertises `'thinking'` in its handshake `capabilities`. The hub forwards the list on every message, and the runtime emits `thinking` events **only** when the triggering message carried the capability. Telegram clients and older SDKs receive nothing new.

### Compatibility matrix

| SDK | Hub | Runtime | Behavior |
|-----|-----|---------|----------|
| old | any | new | indicator appears at turn start (early `typing`) — strict improvement |
| new | old | new | shimmer status only; the old hub's whitelist silently drops `thinking` |
| new | new | old | behavior unchanged from before |
| new | new | new | full thinking timeline |

Every partial deployment state is safe — the event is strictly additive. Recommended rollout order: hub → runtime → SDK.

### Emitting from an agent

```ts
const turnId = crypto.randomUUID()
const step = { id: crypto.randomUUID(), label: 'Search knowledge base' }

bridle.sendThinking(msg.from, turnId, { ...step, state: 'active' })
// ... do the work ...
bridle.sendThinking(msg.from, turnId, { ...step, state: 'done' })
// ... when the whole turn is finished:
bridle.sendThinking(msg.from, turnId)          // no step ⇒ done: true
```

Gate on `msg.capabilities?.includes('thinking')` before emitting.
