# Protocol Overview

The Bridle protocol is what flows on the wire between browsers, the hub, and agents. It's a thin Socket.IO-based layer with a JSON message format.

```
Browser (any site)            Bridle Hub (NestJS)          Agent Runtime
     |                             |                             |
     |--- Socket.IO /ws/chat ----->|                             |
     |   auth: { token, botId }    |--- Socket.IO /ws/agent ---->|
     |                             |   auth: { apiKey, botId }   |
     |<--- stream/message ---------|<--- stream/message ---------|
     |   { text, parts[] }         |   { text, parts[] }         |
```

## Two namespaces

| Namespace | Who connects | Auth |
|-----------|--------------|------|
| `/ws/chat` | Browsers (the SDK) | JWT + botId |
| `/ws/agent` | Agent runtimes | API key + botId |

The hub never lets the two talk directly — it routes by `botId` and `clientId`.

## HTTP fallback

Two HTTP endpoints relay messages without WebSockets:

| Method + path | Purpose |
|---------------|---------|
| `POST /api/agent/:botId/message` | Fire-and-forget |
| `POST /api/agent/:botId/message/sync` | Wait up to 120s for the agent's reply |

Plus health endpoints:

| Method + path | Returns |
|---------------|---------|
| `GET /api/agent/health` | `{ ok, agentConnected, browserClients }` |
| `GET /api/agent/:botId/health` | Same, scoped to one bot |
| `GET /api/agent/:botId/transcript?channel=web` | Persisted chat history |
| `DELETE /api/agent/:botId/transcript?channel=web` | "New chat" — clear history |

See [HTTP API](/protocol/http) for request/response shapes.

## What's stateless and what isn't

- **Hub state**: `Map<botId, agentSocket>` and `Map<clientId, browserSocket>`. Nothing persists. A hub restart drops every connection; clients reconnect automatically.
- **Browser state**: minimal — the SDK keeps the rendered messages in memory. Refresh = fetch transcript.
- **Agent state**: agents may persist transcripts and conversation context themselves. The hub doesn't see this.

This separation is deliberate: it lets the hub scale horizontally without a backing store.

## Versioning

The protocol is at v1. New event types may be added; existing event semantics will not change without a major version bump. The SDK's `data-*` API and `init()` options follow normal semver.
