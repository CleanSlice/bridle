# Bridle Protocol Specification

Bridle connects browser users to an agent runtime through a stateless relay hub.

```
Browser (Nuxt UI)             Bridle Hub (NestJS)           Agent Runtime
     |                             |                             |
     |--- Socket.IO /ws/client ----->|                             |
     |   auth: { token, agentId }    |--- Socket.IO /ws/agent ---->|
     |                             |   auth: { apiKey, agentId }   |
     |<--- stream/message ---------|<--- stream/message ---------|
     |   { text, parts[] }         |   { text, parts[] }         |
```

The hub is stateless -- it does not store messages or conversation history.

---

## Message Parts

All messages carry a `parts` array for rich content. The `text` field is always present as a plain-text shorthand.

### Part Types

```typescript
enum BridlePartTypes {
  Text = 'text',
  Image = 'image',
  File = 'file',
}
```

### Text Part

```json
{ "type": "text", "text": "Hello, how can I help?" }
```

### Image Part

```json
{ "type": "image", "base64": "<base64-encoded>", "mediaType": "image/jpeg" }
```

Supported media types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`.

### File Part

```json
{ "type": "file", "url": "https://example.com/doc.pdf", "name": "doc.pdf", "mimeType": "application/pdf" }
```

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | URL to download the file |
| `name` | string | yes | Display name |
| `mimeType` | string | no | MIME type hint |

### Backward Compatibility

Clients may omit `parts` and send `text` + `images` instead. The hub converts this to parts via `buildParts(text, images)`. All receivers fall back gracefully: if `parts` is missing, they build it from `text`.

---

## Architecture

Three participants, two connections:

| Connection | Transport | Auth | Direction |
|---|---|---|---|
| Browser <-> Hub | Socket.IO `/ws/client` | JWT + agentId | Bidirectional |
| Agent <-> Hub | Socket.IO `/ws/agent` | apiKey + agentId | Bidirectional |

The hub assigns each browser a `clientId` on connection (from JWT `sub`, or `'admin'` for admin users).
All messages between hub and agent include `clientId` and `agentId` for routing.

Multiple agents can connect (one per `agentId`). Multiple browsers can connect simultaneously.

---

## Connection 1: Browser <-> Hub

**Namespace:** `/ws/client`
**Transport:** Socket.IO (WebSocket upgrade)
**Auth:** JWT token + agentId in handshake

### Authentication

```typescript
io('http://hub-host/ws/client', {
  auth: {
    token: '<JWT>',       // Verified by JwtService
    agentId: 'bot-abc-123', // Which bot to chat with
  },
})
```

If `token` or `agentId` is missing, or the JWT is invalid, the client is disconnected immediately.

Admin detection: if JWT `roles` includes `'ADMIN'`, `clientId` is set to `'admin'`.

### Lifecycle

```
1. Browser connects to /ws/client with { token, agentId }
2. Hub verifies JWT, extracts clientId from sub (or 'admin')
3. Hub registers browser under agentId
4. Hub emits  welcome { clientId }  to browser
5. Browser sends/receives messages
6. On disconnect, hub unregisters the clientId
```

### Events: Browser -> Hub

#### `message`

Send a message to the agent. Prefer `parts` for rich content; `text` + `images` is supported for backward compatibility.

```json
{
  "text": "Hello, agent",
  "parts": [
    { "type": "text", "text": "Hello, agent" },
    { "type": "image", "base64": "<base64>", "mediaType": "image/jpeg" }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes | Plain-text shorthand |
| `parts` | BridlePart[] | no | Rich content (source of truth). If omitted, built from text + images. |
| `images` | array | no | Legacy: attached images. Converted to parts if `parts` is absent. |
| `clientMessageId` | string | no | Id minted by the browser, at most 100 characters. Opts the sender into the acknowledgement below; the hub keeps it as the message id end to end and ignores a repeat of it. The SDK sends one with every message since 0.16.0. |

##### Acknowledgement

A hub that supports it answers a `message` that carried a `clientMessageId`
through the socket.io acknowledgement callback:

```ts
type BridleSendAck =
  | { status: 'accepted'; messageId: string; ts: number; duplicate?: boolean }
  | { status: 'rejected'; code: 'AGENT_OFFLINE' | 'ATTACHMENT_FAILED' | 'SHARE_REJECTED' | 'EMPTY'; message?: string }
  | { status: 'rejected'; code: 'RATE_LIMITED'; retryAfterMs: number; window: 'minute' | 'hour' | 'day' }
```

- `accepted` — forwarded to the agent. `messageId` is the browser's own id;
  `duplicate: true` means that id was already accepted and the agent was not
  asked twice.
- `rejected` — not forwarded. The message must not stay on screen as sent, and
  no `typing` will follow.
- A sender that passes a `clientMessageId` renders the outcome itself, so the
  hub does **not** also send it the "Agent is not connected" `message` line
  (see [Agent unavailable](#agent-unavailable)) or the limit fallback line
  (see [Request limits](#request-limits)). A sender that passes none gets no
  acknowledgement and keeps receiving those lines.
- Acknowledging is optional for a hub. The reference hub in `nestjs/` does not:
  the callback is never called, and the client treats the message as taken.
  The SDK settles `client.send()` as `unacknowledged` after 10 s.

#### `ping`

Keepalive check. Hub responds with `pong`.

```json
{}
```

### Request limits

A hub may cap how many requests one agent takes per minute, per hour and per
day. The allowance is the agent's and everyone who talks to it draws on it. A
full window is an expected state with a known end — it is never reported
through `bridle_error`, and a client must not treat it as a failure.

It reaches the browser three ways:

1. **The acknowledgement** of a send:
   `{ status: 'rejected', code: 'RATE_LIMITED', retryAfterMs, window }`.
   `retryAfterMs` is always greater than zero, and when several windows are
   full it is the longest wait, so a countdown never ends in another refusal
   caused by a window that was already full.
2. **The [`agent_limit`](#agent_limit) event**, for an hour or day window, so a
   chat that is only being read learns about the wait before anything is sent.
3. **A plain `message` line**, for a sender that passed no `clientMessageId`
   and so cannot be acknowledged (SDK ≤ 0.15.1). Shaped like the "Agent is not
   connected" reply, English only, not stored by the agent:

   ```text
   This agent has reached its message limit. Try again in about 40 seconds.
   This agent has reached its message limit. Try again in about 12 minutes.
   This agent has reached its message limit. Try again in about 3 hours.
   ```

Order of checks for one message: share link → attachments → empty → duplicate
(`accepted`, `duplicate: true`) → `AGENT_OFFLINE` → `RATE_LIMITED` →
`accepted`.

What a client does with it:

- stores `until = performance.now() + retryAfterMs` — a monotonic clock, so a
  wrong wall clock or a throttled background tab cannot distort the wait — and
  derives what it shows from that, re-reading it on `visibilitychange`;
- takes the refused message back out of the conversation and returns its text
  and attachments to the composer;
- sends nothing until the wait is over, by any path (button, Enter, suggestion,
  form, queued messages), and sends nothing by itself when it ends: if every
  waiting chat fired in the same second most would be refused again.

The reference hub in `nestjs/` does not limit anything; only the types are
there (`BridleSendAck`, `IBridleAgentLimitEvent`).

### Events: Hub -> Browser

#### `welcome`

Sent immediately on connection.

```json
{
  "clientId": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### `message`

Complete (non-streamed) response from the agent.

```json
{
  "type": "message",
  "text": "Hello! How can I help you?",
  "parts": [
    { "type": "text", "text": "Hello! How can I help you?" }
  ],
  "messageId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "ts": 1712847600000
}
```

#### `typing`

Agent has started processing. Display as a typing indicator.

```json
{
  "type": "typing",
  "ts": 1712847600000
}
```

#### `stream`

Partial response chunk. Both `text` and `parts` contain the **accumulated content so far** (not a delta).

```json
{
  "type": "stream",
  "text": "Hello! How can I",
  "parts": [
    { "type": "text", "text": "Hello! How can I" }
  ],
  "messageId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "ts": 1712847600100
}
```

> **Important:** Each `stream` event contains the full accumulated state. The client must **replace** the entire message, not append.

#### `stream_end`

Final chunk. Marks the end of streaming.

```json
{
  "type": "stream_end",
  "text": "Hello! How can I help you today?",
  "parts": [
    { "type": "text", "text": "Hello! How can I help you today?" }
  ],
  "messageId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "ts": 1712847600200
}
```

#### `pong`

Response to `ping`.

```json
{
  "ts": 1712847600000
}
```

#### `agent_limit`

An hour or day [request limit](#request-limits) of the agent is full and will
stay so for a while, or room was made earlier than announced. Optional: sent
only by a hub that limits requests.

```json
{ "type": "agent_limit", "agentId": "agent-abc-123", "limited": true, "retryAfterMs": 720000, "window": "hour" }
```

```json
{ "type": "agent_limit", "agentId": "agent-abc-123", "limited": false }
```

Sent to **every** client socket of the agent, whatever its identity:

| When | Payload |
|------|---------|
| A socket connects and an hour or day window is full | `limited: true`, right after `welcome` |
| An accepted request fills an hour or day window | `limited: true` |
| Limits are raised or removed and nothing is full any more | `limited: false` |
| Limits are lowered or created and an hour or day window is now full | `limited: true` |

Never sent for a full **minute** window — it clears within a minute, and
announcing it to people who are only reading would make a notice flicker — and
never sent when a window frees by time passing: the client counts down by
itself. A client that does not know the event ignores it.

---

## Connection 2: Agent <-> Hub

**Namespace:** `/ws/agent`
**Transport:** Socket.IO (WebSocket upgrade)
**Auth:** apiKey + agentId in handshake

### Authentication

```typescript
io('http://hub-host/ws/agent', {
  auth: {
    apiKey: process.env.BRIDLE_API_KEY,
    agentId: process.env.BRIDLE_AGENT_ID,
  }
})
```

`apiKey` is validated against `BRIDLE_API_KEY` env var. If missing or wrong, the connection is rejected. `agentId` is required -- it scopes all routing. Multiple agents can connect (one per `agentId`).

### Lifecycle

```
1. Agent connects to /ws/agent with { apiKey, agentId }
2. Hub validates apiKey, registers agent under agentId
3. Agent emits  register {}  to confirm readiness
4. Hub forwards browser messages (matching agentId) to agent
5. Agent sends responses back through hub
6. On disconnect, hub unregisters that agentId
```

### Events: Hub -> Agent

#### `message`

A browser user sent a message. Agent should process it and respond.

```json
{
  "type": "message",
  "clientId": "550e8400-e29b-41d4-a716-446655440000",
  "text": "Hello, agent",
  "parts": [
    { "type": "text", "text": "Hello, agent" },
    { "type": "image", "base64": "<base64>", "mediaType": "image/jpeg" }
  ],
  "messageId": "7c9e6679-7425-40de-944b-e07fc1f90ae7"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"message"` | yes | Always `"message"` |
| `clientId` | string | yes | Browser client to respond to |
| `text` | string | yes | Plain-text shorthand |
| `parts` | BridlePart[] | yes | Rich content parts |
| `messageId` | string | yes | UUID v4 for this message |

#### `pong`

Response to agent's `ping`.

```json
{}
```

### Events: Agent -> Hub

All events **must** include `clientId` to route the response to the correct browser.

#### `register`

Agent announces it is ready. Sent after connection or reconnection.

```json
{}
```

#### `message`

Complete (non-streamed) response with rich parts.

```json
{
  "clientId": "550e8400-e29b-41d4-a716-446655440000",
  "text": "Here is the result:",
  "parts": [
    { "type": "text", "text": "Here is the result:" },
    { "type": "image", "base64": "<base64>", "mediaType": "image/png" }
  ],
  "messageId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "ts": 1712847600000
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `kind` | `'thinking' \| 'tool'` | no | Marks this frame as a **note** — the agent's reasoning, not its answer. See [Notes](#notes-agent-reasoning). |

#### Notes (agent reasoning)

An agent that reasons out loud sends those lines as ordinary `message` frames
while it works — one per thought, one per tool it reaches for. They are **not
the answer**, and drawn as answers they are indistinguishable from it: the
visitor reads several bubbles of the agent talking to itself and then, below
them, the reply.

A receiver folds every note of one turn into a single collapsible row above the
answer — the SDK calls it the *work log*.

**A frame is a note when either is true:**

1. It says so — `kind: 'thinking'` (a thought) or `kind: 'tool'` (reaching for
   something). Runtimes should set this; it is the only signal that survives a
   turn with no streamed answer.
2. It arrived **during a turn** — after `typing`, before `stream_end`. A
   runtime raises `typing` when an *answer* is coming and closes with
   `stream_end`, so whatever it sends in between is by definition not that
   answer. This is what lets existing runtimes get the work log without a
   change.

```json
{
  "clientId": "550e8400-e29b-41d4-a716-446655440000",
  "text": "The user is asking for a story — no tools needed here.",
  "parts": [{ "type": "text", "text": "The user is asking for a story — no tools needed here." }],
  "kind": "thinking",
  "messageId": "…",
  "ts": 1712847600000
}
```

Tool notes are conventionally an arrow and the tool's name (`→ searchWeb`); an
unmarked note that starts with `→` is read as `tool`, everything else as
`thinking`.

A plain `message` sent with **no turn open** is an ordinary answer bubble, and
stays one — that is what the reference runtime's `send()` does, and nothing
about it changed.

#### `typing`

Agent is about to start generating a response.

```json
{
  "clientId": "550e8400-e29b-41d4-a716-446655440000",
  "ts": 1712847600000
}
```

#### `stream`

Partial response. Both `text` and `parts` are **accumulated so far**.

```json
{
  "clientId": "550e8400-e29b-41d4-a716-446655440000",
  "text": "Hello! How can I",
  "parts": [
    { "type": "text", "text": "Hello! How can I" }
  ],
  "messageId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "ts": 1712847600100
}
```

#### `stream_end`

Final response.

```json
{
  "clientId": "550e8400-e29b-41d4-a716-446655440000",
  "text": "Hello! How can I help you today?",
  "parts": [
    { "type": "text", "text": "Hello! How can I help you today?" }
  ],
  "messageId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "ts": 1712847600200
}
```

#### `ping`

Keepalive from agent. Hub responds with `pong`.

```json
{}
```

---

## HTTP API

For clients that cannot use WebSocket.

**Base path:** `/api/agent`

### POST /api/agent/:agentId/message

Fire-and-forget. Sends a message to the agent but does not wait for a response.

**Request:**
```json
{
  "text": "Hello, agent",
  "parts": [
    { "type": "text", "text": "Hello, agent" }
  ]
}
```

`parts` is optional. If omitted, built from `text` + `images`.

**Response:** `200 OK`
```json
{ "ok": true }
```

### POST /api/agent/:agentId/message/sync

Synchronous. Sends a message and waits for the complete agent response.

**Timeout:** 120 seconds.

**Request:**
```json
{
  "text": "Hello, agent",
  "parts": [
    { "type": "text", "text": "Hello, agent" }
  ]
}
```

**Response:** `200 OK`
```json
{
  "text": "Hello! How can I help you?",
  "messageId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "ts": 1712847600000
}
```

On timeout:
```json
{
  "text": "Timeout: no response from agent",
  "messageId": "",
  "ts": 1712847600000
}
```

### GET /api/agent/health

Check overall hub status.

**Response:** `200 OK`
```json
{
  "ok": true,
  "agentConnected": true,
  "browserClients": 3
}
```

### GET /api/agent/:agentId/health

Check per-agent status.

**Response:** `200 OK`
```json
{
  "ok": true,
  "agentConnected": true,
  "browserClients": 1,
  "agentId": "bot-abc-123"
}
```

---

## Streaming Model

Bridle uses **accumulated text**, not deltas.

Each `stream` event contains the full response generated so far:

```
stream #1:  text = "Hello"           parts = [{ type: "text", text: "Hello" }]
stream #2:  text = "Hello, how"      parts = [{ type: "text", text: "Hello, how" }]
stream #3:  text = "Hello, how are?" parts = [{ type: "text", text: "Hello, how are?" }]
stream_end: text = "Hello, how are?" parts = [{ type: "text", text: "Hello, how are?" }]
```

### Client implementation

On each `stream` event, **replace** the entire message (both `text` and `parts`). Do not append.

### Agent implementation

The `BridleRepository` batches stream chunks at **100ms intervals**. The agent calls `onChunk(accumulated)` as it generates text, and the repository flushes the latest accumulated value to the hub every 100ms:

```typescript
await bridle.streamSend(clientId, async (onChunk) => {
  let accumulated = ''
  for await (const token of llmStream) {
    accumulated += token
    onChunk(accumulated)  // Full text so far, not just the new token
  }
  return accumulated      // Returned value becomes the stream_end text
})
```

### Tradeoffs

| | Accumulated (Bridle) | Delta-based (e.g. Vercel AI SDK) |
|---|---|---|
| Client complexity | Low -- just replace text + parts | Higher -- must concatenate deltas |
| Bandwidth | O(n^2) over response length | O(n) |
| Missed events | Self-healing -- next event has full state | Data loss -- gaps are permanent |
| Late joiners | Can pick up from any event | Need full history |

The accumulated approach prioritizes simplicity and resilience over bandwidth efficiency.

---

## Type Definitions

### BridlePart (wire format)

```typescript
enum BridlePartTypes {
  Text = 'text',
  Image = 'image',
  File = 'file',
}

interface IBridleTextPart {
  type: BridlePartTypes.Text
  text: string
}

interface IBridleImagePart {
  type: BridlePartTypes.Image
  base64: string
  mediaType: string  // "image/jpeg" | "image/png" | "image/gif" | "image/webp"
}

interface IBridleFilePart {
  type: BridlePartTypes.File
  url: string
  name: string
  mimeType?: string
}

type BridlePart = IBridleTextPart | IBridleImagePart | IBridleFilePart
```

### IBridleIncomingMessage (Hub -> Agent)

```typescript
interface IBridleIncomingMessage {
  type: 'message'
  clientId: string
  agentId: string
  text: string
  parts: BridlePart[]
  messageId: string
}
```

### IBridleOutgoingEvent (Agent -> Hub)

```typescript
interface IBridleOutgoingEvent {
  type: 'register' | 'message' | 'stream' | 'stream_end' | 'typing' | 'ping'
  clientId?: string
  text?: string
  parts?: BridlePart[]
  messageId?: string
  ts?: number
  /** On `message` only: this frame is a note, not the answer. */
  kind?: 'thinking' | 'tool'
}
```

### IBridleHealthData

```typescript
interface IBridleHealthData {
  ok: boolean
  agentConnected: boolean  // Whether any agent is connected
  browserClients: number   // Total connected browsers
}
```

### IBridleAgentHealthData

```typescript
interface IBridleAgentHealthData {
  ok: boolean
  agentConnected: boolean  // Whether this agent's runtime is connected
  browserClients: number   // Browsers connected to this agent
  agentId: string          // Agent identifier
}
```

### IBridleMessageData (Browser client-side)

```typescript
interface IBridleMessageData {
  id: string
  role: 'user' | 'assistant'
  text: string
  parts: BridlePart[]
  ts: number
  streaming?: boolean
}
```

---

## Environment Variables

| Variable | Where | Required | Description |
|---|---|---|---|
| `BRIDLE_API_KEY` | Hub + Agent | yes | Shared secret for agent auth. Hub validates, agent sends. |
| `BRIDLE_AGENT_ID` | Agent | yes | Bot identifier sent in Socket.IO auth handshake |
| `BRIDLE_URL` | Agent | yes | Hub URL, e.g. `http://localhost:3333` |
| `JWT_SECRET` | Hub | yes | Secret for JWT verification of browser tokens |

---

## Sequence Diagrams

### Normal message with parts

```
Browser              Hub                 Agent
   |                  |                    |
   |-- message ------>|                    |
   |  { text, parts } |-- message -------->|
   |                  |  { clientId, text,  |
   |                  |    parts }          |
   |                  |                    |  (processing)
   |                  |<-- message --------|
   |<-- message ------|  { text, parts,    |
   |  { text, parts,  |    clientId }       |
   |    ts }           |                    |
```

### Streamed response

```
Browser              Hub                 Agent
   |                  |                    |
   |-- message ------>|                    |
   |  { text, parts } |-- message -------->|
   |                  |                    |
   |                  |<-- typing ---------|
   |<-- typing -------|                    |
   |                  |                    |
   |                  |<-- stream ---------|  (100ms flush)
   |<-- stream -------|  { text, parts }   |
   |                  |                    |
   |                  |<-- stream ---------|  (100ms flush)
   |<-- stream -------|  { text, parts }   |
   |                  |                    |
   |                  |<-- stream_end -----|
   |<-- stream_end ---|  { text, parts }   |
```

### Rich response (text + image)

```
Browser              Hub                 Agent
   |                  |                    |
   |-- message ------>|                    |
   |  { text, parts:  |                    |
   |    [text] }       |-- message -------->|
   |                  |                    |  (processing)
   |                  |<-- message --------|
   |<-- message ------|  { text, parts:    |
   |  { text, parts:  |    [text, image] } |
   |    [text, image] }|                    |
```

### Agent unavailable

```
Browser              Hub
   |                  |
   |-- message ------>|
   |                  |  (no agent for this agentId)
   |<-- message ------|
   |  { text: "Agent is not connected...",
   |    parts: [{ type: "text", text: "Agent is not connected..." }] }
```

A sender that passed a `clientMessageId` to a hub that acknowledges gets the
same fact in the acknowledgement instead, and no `message`:

```
Browser              Hub
   |                  |
   |-- message ------>|  { text, parts, clientMessageId }
   |                  |  (no agent for this agentId)
   |<-- ack ----------|
   |  { status: "rejected", code: "AGENT_OFFLINE" }
```

The SDK (≥ 0.16.0) then shows the "Agent is not connected. Please try again
later." line itself, so the visitor sees what they always saw.

### Request limit reached

```
Browser              Hub                 Agent
   |                  |                    |
   |-- message ------>|  { text, parts, clientMessageId }
   |                  |  (the agent's minute window is full)
   |<-- ack ----------|                    |  (nothing is forwarded)
   |  { status: "rejected", code: "RATE_LIMITED",
   |    retryAfterMs: 42000, window: "minute" }
   |                  |
   |  takes the bubble back, keeps the text in the composer,
   |  shows "Try again in 0:42." and sends nothing for 42 s
   |                  |
   |-- message ------>|  (pressed by the person after the wait)
   |<-- ack ----------|  { status: "accepted", messageId, ts }
   |                  |-- message -------->|
```

When the request that was just accepted fills an hour or day window, every
socket of the agent hears about it at once:

```
Browser A            Hub                 Browser B
   |-- message ------>|                    |
   |<-- ack accepted -|                    |
   |<-- agent_limit --|-- agent_limit ---->|
   |  { limited: true, retryAfterMs: 720000, window: "hour" }
```

### HTTP sync fallback

```
HTTP Client                   Hub                 Agent
   |                           |                    |
   |-- POST /:agentId/message -->|                    |
   |   /sync  { text, parts }  |-- message -------->|
   |                           |                    |  (processing)
   |                           |<-- message --------|
   |<-- 200 { text, ts } ------|                    |
```

### Agent reconnection

```
Hub                  Agent
 |                    |
 |  (agent disconnects)
 |                    |
 |  (browsers get "Agent is not connected" on new messages)
 |                    |
 |<-- connect --------|  (auto-reconnect after 3s)
 |<-- register -------|
 |                    |
 |  (messages resume normally)
```
