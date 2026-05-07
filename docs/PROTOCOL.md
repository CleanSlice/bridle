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

#### `ping`

Keepalive check. Hub responds with `pong`.

```json
{}
```

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

Check per-bot status.

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

### IBridleBotHealthData

```typescript
interface IBridleBotHealthData {
  ok: boolean
  agentConnected: boolean  // Whether this bot's agent is connected
  browserClients: number   // Browsers connected to this bot
  agentId: string            // Bot identifier
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
