# HTTP API

For server-to-server use, fire-and-forget bots, and transcript replay, the hub exposes a small REST surface alongside the WebSocket namespaces.

## Send a message (fire-and-forget)

```http
POST /api/agent/:botId/message
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "text": "Hello",
  "parts": [{ "type": "text", "text": "Hello" }]
}
```

Response:

```json
{ "ok": true }
```

The hub forwards the message to the agent for `:botId` and returns immediately. Use this when you don't care about the reply (notifications, follow-ups dispatched elsewhere).

## Send a message (synchronous)

```http
POST /api/agent/:botId/message/sync
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "text": "What's the weather like?"
}
```

Response (within 120 seconds):

```json
{
  "text": "It's sunny in San Francisco.",
  "messageId": "m-abc",
  "ts": 1746700000000
}
```

If the agent doesn't reply within 120 seconds, the response is:

```json
{
  "text": "Timeout: no response from agent",
  "messageId": "",
  "ts": 1746700000000
}
```

The sync endpoint follows streaming semantics internally — `stream` events accumulate, and the final `message` or `stream_end` resolves the request.

## Health checks

```http
GET /api/agent/health
```

```json
{ "ok": true, "agentConnected": false, "browserClients": 0 }
```

```http
GET /api/agent/:botId/health
```

```json
{ "ok": true, "agentConnected": true, "browserClients": 3, "botId": "bot-abc-123" }
```

Use these for liveness checks in your monitoring.

## List connected agents

```http
GET /api/agent/agents
```

```json
[
  { "botId": "bot-a", "clients": 2 },
  { "botId": "bot-b", "clients": 0 }
]
```

## Transcript replay

The agent runtime is responsible for persisting transcripts (the hub stays stateless). When a transcript is persisted, the hub exposes it for replay:

```http
GET /api/agent/:botId/transcript?channel=web
Authorization: Bearer <jwt>
```

```json
{
  "channel": "web",
  "messages": [
    { "id": "m-1", "role": "user", "text": "Hi", "ts": 1746700000000 },
    { "id": "m-2", "role": "assistant", "text": "Hello!", "ts": 1746700001000 }
  ]
}
```

The SDK calls this on mount to fill the chat with prior history. Returns an empty array if nothing is persisted.

## Clear transcript ("new chat")

```http
DELETE /api/agent/:botId/transcript?channel=web
Authorization: Bearer <jwt>
```

```json
{ "ok": true }
```

Removes the persisted transcript for the given channel. The agent's in-memory context may persist until its next restart — this only clears the replay buffer.

## Auth

All HTTP endpoints accept the same JWT used for `/ws/chat`. Pass it via `Authorization: Bearer <jwt>`. Anonymous use is **not** supported on the hub.

The fire-and-forget and sync send endpoints can also be hit by another backend with a service-account JWT — same scheme, same secret.

## Channel parameter

The `channel` query parameter scopes the transcript namespace. Browsers connecting through the SDK use whatever channel the agent uses for that bot — by convention, `web` for end-user chat, `admin` for the admin panel. The agent decides what channels exist; the hub just relays the parameter.

## Errors

| Status | Meaning |
|--------|---------|
| 401 | Missing or invalid JWT |
| 404 | No transcript for this `botId`/`channel` (returned with `messages: []` instead, in some configurations) |
| 503 | Agent not connected (in some flows; sync endpoint returns `ok: true` with a placeholder text message) |
