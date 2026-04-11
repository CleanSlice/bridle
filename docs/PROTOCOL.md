# Bridle Protocol Specification

Bridle connects browser users to an agent runtime through a stateless relay hub.

```
Browser (Nuxt UI)             Bridle Hub (NestJS)           Agent Runtime
     |                             |                             |
     |--- Socket.IO /ws/chat ----->|                             |
     |                             |--- Socket.IO /ws/agent ---->|
     |                             |                             |
     |<--- stream/message ---------|<--- stream/message ---------|
```

The hub is stateless -- it does not store messages or conversation history.

---

## Architecture

Three participants, two connections:

| Connection | Transport | Direction |
|---|---|---|
| Browser <-> Hub | Socket.IO `/ws/chat` | Bidirectional |
| Agent <-> Hub | Socket.IO `/ws/agent` | Bidirectional |

The hub assigns each browser a unique `clientId` (UUID v4) on connection.
All messages between hub and agent include `clientId` for routing.

Only **one agent** can be connected at a time. Multiple browsers can connect simultaneously.

---

## Connection 1: Browser <-> Hub

**Namespace:** `/ws/chat`
**Transport:** Socket.IO (WebSocket upgrade)
**Auth:** None (CORS: `*`)

### Lifecycle

```
1. Browser connects to /ws/chat
2. Hub generates clientId (UUID v4), registers browser
3. Hub emits  welcome { clientId }  to browser
4. Browser sends/receives messages
5. On disconnect, hub unregisters the clientId
```

### Events: Browser -> Hub

#### `message`

Send a text message (optionally with images) to the agent.

```json
{
  "text": "Hello, agent",
  "images": [
    {
      "base64": "<base64-encoded image data>",
      "mediaType": "image/jpeg"
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes | Message text |
| `images` | array | no | Attached images |
| `images[].base64` | string | yes (if images) | Base64-encoded image data |
| `images[].mediaType` | string | yes (if images) | `image/jpeg`, `image/png`, `image/gif`, `image/webp` |

#### `ping`

Keepalive check. Hub responds with `pong`.

```json
{}
```

### Events: Hub -> Browser

#### `welcome`

Sent immediately on connection. Contains the assigned client ID.

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

Partial response chunk. The `text` field contains the **accumulated text so far** (not a delta).

```json
{
  "type": "stream",
  "text": "Hello! How can I",
  "messageId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "ts": 1712847600100
}
```

> **Important:** Each `stream` event contains the full accumulated text up to that point. The client must **replace** the entire message text, not append.

#### `stream_end`

Final chunk. Marks the end of streaming. The `text` field contains the complete response.

```json
{
  "type": "stream_end",
  "text": "Hello! How can I help you today?",
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

---

## Connection 2: Agent <-> Hub

**Namespace:** `/ws/agent`
**Transport:** Socket.IO (WebSocket upgrade)

### Authentication

Agent connects with auth credentials in the Socket.IO handshake:

```typescript
io('http://hub-host/ws/agent', {
  auth: {
    apiKey: process.env.BRIDLE_API_KEY,
    botId: process.env.BRIDLE_BOT_ID,
  }
})
```

Both fields are optional. The hub accepts the connection regardless but the fields are available for middleware auth guards.

### Lifecycle

```
1. Agent connects to /ws/agent
2. Hub registers the agent immediately
3. Agent emits  register {}  to confirm readiness
4. Hub forwards browser messages to agent
5. Agent sends responses back through hub to the correct browser
6. On disconnect, hub marks agent as unavailable
```

Only **one agent** can be connected at a time. A new agent connection replaces the previous one.

### Events: Hub -> Agent

#### `message`

A browser user sent a message. Agent should process it and respond.

```json
{
  "type": "message",
  "clientId": "550e8400-e29b-41d4-a716-446655440000",
  "text": "Hello, agent",
  "messageId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "images": [
    {
      "base64": "<base64-encoded image data>",
      "mediaType": "image/jpeg"
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"message"` | yes | Always `"message"` |
| `clientId` | string | yes | Browser client to respond to |
| `text` | string | yes | User's message text |
| `messageId` | string | yes | UUID v4 for this message |
| `images` | array | no | User's attached images |
| `images[].base64` | string | yes (if images) | Base64-encoded image data |
| `images[].mediaType` | string | yes (if images) | MIME type |

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

Complete (non-streamed) response. Use this for short responses where streaming adds no value.

```json
{
  "clientId": "550e8400-e29b-41d4-a716-446655440000",
  "text": "Hello! How can I help you?",
  "messageId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "ts": 1712847600000
}
```

#### `typing`

Agent is about to start generating a response. Hub forwards to the browser as a typing indicator.

```json
{
  "clientId": "550e8400-e29b-41d4-a716-446655440000",
  "ts": 1712847600000
}
```

#### `stream`

Partial response. `text` is the **accumulated text so far** (not a delta).

```json
{
  "clientId": "550e8400-e29b-41d4-a716-446655440000",
  "text": "Hello! How can I",
  "messageId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "ts": 1712847600100
}
```

#### `stream_end`

Final response text. Marks the end of streaming.

```json
{
  "clientId": "550e8400-e29b-41d4-a716-446655440000",
  "text": "Hello! How can I help you today?",
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

### POST /api/agent/message

Fire-and-forget. Sends a message to the agent but does not wait for a response.

**Request:**
```json
{
  "text": "Hello, agent",
  "images": [
    { "base64": "...", "mediaType": "image/jpeg" }
  ]
}
```

**Response:** `200 OK`
```json
{ "ok": true }
```

If no agent is connected, the hub silently drops the message (no error).

### POST /api/agent/message/sync

Synchronous. Sends a message and waits for the complete agent response.

**Timeout:** 120 seconds.

**Request:**
```json
{
  "text": "Hello, agent",
  "images": [
    { "base64": "...", "mediaType": "image/jpeg" }
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

Check hub and agent connection status.

**Response:** `200 OK`
```json
{
  "ok": true,
  "agentConnected": true,
  "browserClients": 3
}
```

---

## Streaming Model

Bridle uses **accumulated text**, not deltas.

Each `stream` event contains the full response text generated so far:

```
stream #1:  text = "Hello"
stream #2:  text = "Hello, how"
stream #3:  text = "Hello, how are you?"
stream_end: text = "Hello, how are you?"
```

### Client implementation

On each `stream` event, **replace** the entire message text. Do not append.

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
| Client complexity | Low -- just replace text | Higher -- must concatenate deltas |
| Bandwidth | O(n^2) over response length | O(n) |
| Missed events | Self-healing -- next event has full state | Data loss -- gaps are permanent |
| Late joiners | Can pick up from any event | Need full history |

The accumulated approach prioritizes simplicity and resilience over bandwidth efficiency.

---

## Type Definitions

### IBridleImageData

```typescript
interface IBridleImageData {
  base64: string    // Base64-encoded image data
  mediaType: string // "image/jpeg" | "image/png" | "image/gif" | "image/webp"
}
```

### IBridleIncomingMessage (Hub -> Agent)

```typescript
interface IBridleIncomingMessage {
  type: 'message'
  clientId: string        // Target browser client
  text: string            // User's message text
  messageId: string       // UUID v4
  images?: IBridleImageData[]
}
```

### IBridleOutgoingEvent (Agent -> Hub)

```typescript
interface IBridleOutgoingEvent {
  type: 'register' | 'message' | 'stream' | 'stream_end' | 'typing' | 'ping'
  clientId?: string       // Required for message/stream/stream_end/typing
  text?: string           // Response text
  messageId?: string      // UUID v4, consistent across stream chunks
  ts?: number             // Unix timestamp in milliseconds
}
```

### IBridleHealthData

```typescript
interface IBridleHealthData {
  ok: boolean
  agentConnected: boolean  // Whether the agent runtime is connected
  browserClients: number   // Number of connected browsers
}
```

### IBridleMessageData (Browser client-side)

```typescript
interface IBridleMessageData {
  id: string
  role: 'user' | 'assistant'
  text: string
  ts: number
  streaming?: boolean      // True while stream events are arriving
}
```

---

## Environment Variables

| Variable | Where | Required | Description |
|---|---|---|---|
| `BRIDLE_API_KEY` | Hub + Agent | yes | Shared secret for agent auth. Hub validates, agent sends. |
| `BRIDLE_BOT_ID` | Agent | yes | Bot identifier sent in Socket.IO auth handshake |
| `BRIDLE_URL` | Agent | yes | Hub URL, e.g. `http://localhost:3333` |
| `JWT_SECRET` | Hub | yes | Secret for JWT verification of browser tokens |

---

## Sequence Diagrams

### Normal message (no streaming)

```
Browser              Hub                 Agent
   |                  |                    |
   |-- message ------>|                    |
   |  { text }        |-- message -------->|
   |                  |  { clientId, text } |
   |                  |                    |  (processing)
   |                  |<-- message --------|
   |<-- message ------|  { clientId, text } |
   |  { text, ts }    |                    |
```

### Streamed response

```
Browser              Hub                 Agent
   |                  |                    |
   |-- message ------>|                    |
   |                  |-- message -------->|
   |                  |                    |
   |                  |<-- typing ---------|
   |<-- typing -------|                    |
   |                  |                    |
   |                  |<-- stream ---------|  (100ms flush)
   |<-- stream -------|  { text: "Hi" }    |
   |                  |                    |
   |                  |<-- stream ---------|  (100ms flush)
   |<-- stream -------|  { text: "Hi there" }
   |                  |                    |
   |                  |<-- stream_end -----|
   |<-- stream_end ---|  { text: "Hi there!" }
```

### Agent unavailable

```
Browser              Hub
   |                  |
   |-- message ------>|
   |                  |  (no agent connected)
   |<-- message ------|
   |  { text: "Agent is not connected. Please try again later." }
```

### HTTP sync fallback

```
HTTP Client                   Hub                 Agent
   |                           |                    |
   |-- POST /message/sync ---->|                    |
   |                           |-- message -------->|
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
