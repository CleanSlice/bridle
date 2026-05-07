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

### Browser → Hub

| Event | Payload | Effect |
|-------|---------|--------|
| `message` | `{ text, parts? }` | Forward to the agent for this `agentId` |
| `ping` | `{}` | Keepalive — hub responds with `pong { ts }` |

The browser's `clientId` is derived from the JWT (`sub`, or `'admin'` for admins) — not sent on outgoing events.

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
| `message` | `{ clientId, text, parts, messageId, ts }` | Final reply, routed back to browser |
| `stream` | `{ clientId, text, parts, messageId, ts }` | Partial reply (accumulated) |
| `stream_end` | `{ clientId, text, parts, messageId, ts }` | Stream finished |
| `typing` | `{ clientId, ts }` | Show typing indicator on browser |
| `ping` | `{}` | Keepalive |

The agent must echo the same `messageId` across `stream` and `stream_end` for one logical response — this is how the browser groups partials into a single message.

## Field reference

| Field | Type | Purpose |
|-------|------|---------|
| `clientId` | string | Browser session identifier — assigned by hub from JWT `sub` |
| `agentId` | string | Bot identifier — set in handshake |
| `messageId` | string | Stable id across stream chunks for one response |
| `text` | string | Plain-text rollup of all text parts |
| `parts` | `BridlePart[]` | Rich content array (see [Message Parts](/protocol/parts)) |
| `ts` | number | Unix ms timestamp |

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
