# WebSocket Events

Full reference for events on the `/ws/client` and `/ws/agent` namespaces.

## /ws/client (browser ↔ hub)

### Handshake

Connect with auth payload:

```ts
{ token: '<jwt>', agentId: 'agent-abc-123' }
```

The hub disconnects unauthorized clients in `handleConnection` before any events are processed.

### Hub → Browser

| Event | Payload | When |
|-------|---------|------|
| `welcome` | `{ clientId: string }` | Immediately after auth succeeds |
| `message` | `{ text, parts, messageId, ts }` | Final agent message (non-streaming) |
| `stream` | `{ text, parts, messageId, ts }` | Partial agent text (accumulated) |
| `stream_end` | `{ text, parts, messageId, ts }` | Stream finished |
| `typing` | `{}` | Agent is processing |
| `agent_limit` | `{ agentId, limited: true, retryAfterMs, window: 'hour' \| 'day' }` or `{ agentId, limited: false }` | Optional. An hour or day [request limit](#request-limits) of the agent is full — right after `welcome`, or when it fills — or room was made early |

### Browser → Hub

| Event | Payload | Effect |
|-------|---------|--------|
| `message` | `{ text, parts?, clientMessageId? }` | Forward to the agent for this `agentId`. With a `clientMessageId` the hub may [acknowledge](#acknowledgement) |
| `ping` | `{}` | Keepalive — hub responds with `pong { ts }` |

The browser's `clientId` is derived from the JWT (`sub`, or `'admin'` for admins) — not sent on outgoing events.

### Acknowledgement

A `message` that carries a `clientMessageId` (the SDK sends one with every message since 0.16.0) can be answered through the socket.io acknowledgement callback:

```ts
type BridleSendAck =
  | { status: 'accepted'; messageId: string; ts: number; duplicate?: boolean }
  | { status: 'rejected'; code: 'AGENT_OFFLINE' | 'ATTACHMENT_FAILED' | 'SHARE_REJECTED' | 'EMPTY'; message?: string }
  | { status: 'rejected'; code: 'RATE_LIMITED'; retryAfterMs: number; window: 'minute' | 'hour' | 'day' }
```

A rejected message was not forwarded. Because such a sender renders the outcome itself, the hub does not also send it the "Agent is not connected" line as a `message`; a sender without a `clientMessageId` gets no acknowledgement and keeps receiving that line.

Acknowledging is optional. The reference hub does not: the callback is never called and the client treats the message as taken (`client.send()` settles as `unacknowledged` after 10 s).

### Request limits

A hub may cap the requests one agent takes per minute, hour and day. A full window is an expected state with a known end, never a `bridle_error`.

| The sender | Learns it from |
|------------|----------------|
| Passed a `clientMessageId` | The acknowledgement: `{ status: 'rejected', code: 'RATE_LIMITED', retryAfterMs, window }` |
| Is only reading, and an hour or day window is full | `agent_limit` |
| Passed no `clientMessageId` (SDK ≤ 0.15.1) | A plain `message`: "This agent has reached its message limit. Try again in about 40 seconds." |

`agent_limit` is never sent for a minute window, and never when a window frees by time passing — the client counts down by itself, on `performance.now()`, and sends nothing on its own when the wait ends. What the widget shows is described in [NPM › Request limits](/embed/npm#request-limits).

The reference hub does not limit anything; it only carries the types.

## /ws/agent (agent runtime ↔ hub)

### Handshake

```ts
{ apiKey: '<BRIDLE_API_KEY>', agentId: '<agent-id>' }
```

### Hub → Agent

| Event | Payload | When |
|-------|---------|------|
| `message` | `{ clientId, text, parts, messageId, ts }` | Browser sent a message |
| `pong` | `{}` | Reply to `ping` |

The `clientId` field tells the agent which browser sent the message — use it as the `to` argument when responding.

### Agent → Hub

| Event | Payload | Effect |
|-------|---------|--------|
| `register` | `{}` | (Optional, post-connect bookkeeping) |
| `message` | `{ clientId, text, parts, messageId, ts, kind? }` | Final reply, routed back to browser — or a **note** when `kind` is set or a turn is open (see below) |
| `stream` | `{ clientId, text, parts, messageId, ts }` | Partial reply (accumulated) |
| `stream_end` | `{ clientId, text, parts, messageId, ts }` | Stream finished |
| `typing` | `{ clientId, ts }` | Show typing indicator on browser |
| `ping` | `{}` | Keepalive |

The agent must echo the same `messageId` across `stream` and `stream_end` for one logical response — this is how the browser groups partials into a single message.

### Notes — the agent's reasoning

An agent that reasons out loud sends those lines as ordinary `message` frames
while it works. They are **not** the answer, and the browser must not draw them
as one: it folds every note of a turn into one collapsible *work log* row above
the reply.

A frame is a note when either holds:

1. **It says so** — `kind: 'thinking'` (a thought) or `kind: 'tool'` (reaching
   for something). Set this if you can; it is the only signal that survives a
   turn that never streams an answer.
2. **It arrived during a turn** — after `typing`, before `stream_end`. A
   runtime raises `typing` when an *answer* is coming, so anything sent in
   between is not that answer.

A `message` sent with no turn open is an ordinary reply, exactly as before.
Tool notes are conventionally `→ toolName`.

```json
{ "clientId": "…", "text": "Checking the order status first.", "kind": "thinking", "ts": 1712847600000 }
```

## Field reference

| Field | Type | Purpose |
|-------|------|---------|
| `clientId` | string | Browser session identifier — assigned by hub from JWT `sub` |
| `agentId` | string | Bot identifier — set in handshake |
| `messageId` | string | Stable id across stream chunks for one response |
| `text` | string | Plain-text rollup of all text parts |
| `parts` | `BridlePart[]` | Rich content array (see [Message Parts](/protocol/parts)) |
| `ts` | number | Unix ms timestamp |
| `kind` | `'thinking' \| 'tool'` | On `message` only: this frame is a note, not the answer |

## Sequence diagrams

### Non-streaming reply

```
Browser           Hub             Agent
   |               |                |
   |--message----->|                |
   |               |--message------>|
   |               |                |
   |               |<--typing-------|
   |<--typing------|                |
   |               |                |
   |               |<--message------|
   |<--message-----|                |
```

### Streaming reply

```
Browser           Hub             Agent
   |               |                |
   |--message----->|                |
   |               |--message------>|
   |               |                |
   |               |<--typing-------|
   |<--typing------|                |
   |               |<--stream-------|  (every 100ms)
   |<--stream------|                |
   |               |<--stream-------|
   |<--stream------|                |
   |               |<--stream_end---|
   |<--stream_end--|                |
```

### HTTP sync fallback

```
HTTP client       Hub             Agent
   |               |                |
   |--POST sync--->|                |
   |               |--message------>|
   |               |                |
   |               |<--message------|
   |<--JSON resp---|                |
```

`POST /api/agent/:agentId/message/sync` waits up to 120 seconds for the agent's reply and returns it as JSON. See [HTTP API](/protocol/http) for the request shape.
