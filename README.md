![Bridle](./docs/cleanslice-bridle-background.png)

# Bridle

Webchat relay for AI agents. Bridle connects browser users to an agent runtime through a stateless NestJS hub, with a ready-made Nuxt chat UI and an agent-side Socket.IO client.

```
Browser (Nuxt)               Bridle Hub (NestJS)           Agent Runtime
     |                             |                             |
     |--- /ws/chat --------------->|                             |
     |   auth: { token, botId }    |--- /ws/agent -------------->|
     |                             |   auth: { apiKey, botId }   |
     |<--- stream/message ---------|<--- stream/message ---------|
```

The hub is **stateless** -- it holds no message history. It routes messages between browsers and agents in real time using Socket.IO. Multiple bots can connect simultaneously, each scoped by `botId`.

## Packages

| Directory | Description | Stack |
|-----------|-------------|-------|
| `nestjs/` | Hub server -- WebSocket relay + HTTP fallback | NestJS, Socket.IO, JWT |
| `nuxt/` | Chat UI -- drop-in component + Pinia store | Nuxt 3, Vue 3, shadcn-vue |
| `runtime/` | Agent client -- connects to the hub as a channel | Socket.IO client |

## Authentication

Bridle authenticates both sides of the connection in the Socket.IO handshake. Auth is checked in `handleConnection` -- unauthorized clients are disconnected immediately before any events are processed.

### Agent auth (apiKey + botId)

Agent runtimes prove identity with a shared API key and declare which bot they serve:

```typescript
io('http://hub-host/ws/agent', {
  auth: {
    apiKey: process.env.INTERNAL_API_KEY,  // Shared secret
    botId: process.env.WEB_BOT_ID,         // Which bot this agent serves
  },
})
```

The hub validates `apiKey` against the `INTERNAL_API_KEY` environment variable. If the key is missing or wrong, the connection is rejected. `botId` is required -- it scopes all message routing to that bot.

### Browser auth (JWT + botId)

Browser clients authenticate with a JWT token and specify which bot to chat with:

```typescript
io('http://hub-host/ws/chat', {
  auth: {
    token: 'eyJhbG...',                   // JWT from your auth system
    botId: 'bot-abc-123',                  // Which bot to chat with
  },
})
```

The hub verifies the JWT using NestJS `JwtService`. The token payload determines identity:

| JWT field | Usage |
|-----------|-------|
| `sub` | Used as `clientId` for message routing |
| `email` | Stored in socket data for logging |
| `roles` | If includes `'ADMIN'`, `clientId` is set to `'admin'` |

### Admin detection

When the JWT payload contains `roles: ['ADMIN']`, the hub sets `clientId = 'admin'` instead of `sub`. This allows the agent runtime's access control to recognize admin users:

```typescript
// In the agent runtime
if (msg.from === 'admin') {
  // This user has admin privileges
}
```

### Per-bot isolation

Each bot agent registers with its own `botId`. Browser clients also declare a `botId` when connecting. The hub enforces isolation:

- Messages from a browser are only forwarded to the agent matching that `botId`
- Agent responses are only routed to browsers registered under the same `botId`
- Multiple bots can serve different users simultaneously through the same hub

```
Bot A (/ws/agent, botId: "bot-a")     Hub      Browser 1 (/ws/chat, botId: "bot-a")
Bot B (/ws/agent, botId: "bot-b")     Hub      Browser 2 (/ws/chat, botId: "bot-b")
```

### Why handleConnection, not NestJS guards?

NestJS WebSocket guards (`@UseGuards`) only run on `@SubscribeMessage` handlers, not on the initial connection. An unauthorized client would stay connected and receive broadcast events. Checking credentials in `handleConnection` + calling `client.disconnect(true)` is simpler and more secure.

## Hub Server (NestJS)

The hub exposes two WebSocket namespaces and an HTTP API:

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `/ws/chat` | JWT + botId | Browser clients connect here |
| `/ws/agent` | apiKey + botId | Agent runtimes connect here |
| `POST /api/agent/:botId/message` | Bearer token | HTTP fire-and-forget message |
| `POST /api/agent/:botId/message/sync` | Bearer token | HTTP synchronous message (120s timeout) |
| `GET /api/agent/health` | -- | Overall hub status |
| `GET /api/agent/:botId/health` | -- | Per-bot status |

### Usage

```typescript
// app.module.ts
import { BridleModule } from 'bridle/nestjs'

@Module({
  imports: [BridleModule],
})
export class AppModule {}
```

`BridleModule` imports `ConfigModule` (for `INTERNAL_API_KEY`) and `JwtModule` (for token verification). Your app must have `JWT_SECRET` configured.

### Exports

```typescript
// Module
BridleModule

// Domain (abstract gateway + types)
IBridleGateway          // Abstract class -- DI token
IBridleHealthData       // { ok, agentConnected, browserClients }
IBridleImageData        // { base64, mediaType }
IBridleIncomingMessage  // Hub -> Agent message (includes botId)
IBridleOutgoingEvent    // Agent -> Hub event
IBridleClientData       // { botId, send } -- registered client metadata

// Data (concrete implementation)
BridleGateway           // Hub implementation with per-bot maps

// Presentation
BridleController        // HTTP endpoints (/:botId scoped)
ChatWsGateway           // Browser WebSocket handler (JWT auth)
AgentWsGateway          // Agent WebSocket handler (apiKey auth)

// DTOs
SendMessageDto          // Request body for message endpoints
BridleHealthDto         // Response for health endpoints
```

## Chat UI (Nuxt)

A drop-in chat widget built with shadcn-vue. Connects to the hub via Socket.IO with JWT authentication and manages all state through a Pinia store.

### Usage

Add the slice as a Nuxt layer, then use the component:

```vue
<template>
  <BridleProvider
    api-url="http://localhost:3333"
    bot-id="bot-abc-123"
    :token="authToken"
  />
</template>
```

### Components

| Component | File | Description |
|-----------|------|-------------|
| `BridleProvider` | `components/bridle/Provider.vue` | Full chat widget -- connection, messages, input |
| `BridleMessage` | `components/bridle/Message.vue` | Single message bubble (user or assistant) |
| `BridleInput` | `components/bridle/Input.vue` | Text input with send button |

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `apiUrl` | string | yes | Hub server URL |
| `botId` | string | yes | Which bot to chat with |
| `token` | string | yes | JWT token for authentication |
| `title` | string | no | Header title (default: "Agent Chat") |
| `placeholder` | string | no | Input placeholder text |
| `showStatus` | boolean | no | Show connection indicator (default: true) |

### Store

```typescript
const store = useBridleStore()

store.connect('http://localhost:3333', 'bot-abc-123', jwtToken)
store.sendMessage('Hello')
store.disconnect()

// Reactive state
store.messages     // IBridleMessageData[]
store.isConnected  // boolean
store.isTyping     // boolean
store.isOpen       // boolean (for toggle UI)
store.clientId     // string | null (assigned by hub)
```

The store handles `connect_error` events -- if the JWT is invalid or expired, `isConnected` stays `false` and the error is logged to console.

### Nuxt Config

The slice registers a `#bridle` alias:

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['./path/to/bridle/nuxt'],
})
```

## Agent Client (Runtime)

`BridleRepository` connects to the hub as a Socket.IO client and implements the `IChannelGateway` interface. It authenticates using `WEB_API_KEY` and `WEB_BOT_ID` environment variables.

### Usage

```typescript
import { BridleRepository } from 'bridle/runtime/bridle.repository'

const bridle = new BridleRepository('http://localhost:3333')

bridle.onMessage(async (msg) => {
  console.log(`[${msg.from}]: ${msg.text}`)

  // Simple response
  await bridle.send(msg.from, 'Hello from the agent!')

  // Or stream a response
  await bridle.streamSend(msg.from, async (onChunk) => {
    const text = await generateResponse(msg.text, onChunk)
    return text
  })
})

await bridle.start()
```

The repository reads auth credentials from environment variables on connect:

```typescript
// These are passed automatically in the Socket.IO handshake
auth: {
  apiKey: process.env.WEB_API_KEY ?? process.env.INTERNAL_API_KEY,
  botId: process.env.WEB_BOT_ID ?? process.env.BOT_ID,
}
```

### Streaming

`streamSend` accepts a streamer function. The agent calls `onChunk` with **accumulated text** as it generates. Bridle batches these into `stream` events every 100ms and sends a final `stream_end` when the streamer resolves.

```typescript
await bridle.streamSend(clientId, async (onChunk) => {
  let accumulated = ''
  for await (const token of llmStream) {
    accumulated += token
    onChunk(accumulated)  // Accumulated, not delta
  }
  return accumulated
})
```

## Protocol

See [PROTOCOL.md](./docs/PROTOCOL.md) for the full specification including:

- WebSocket event schemas for both connections
- HTTP API request/response formats
- Streaming model (accumulated text, not deltas)
- Sequence diagrams for all message flows
- TypeScript type definitions

## Environment Variables

| Variable | Where | Required | Description |
|----------|-------|----------|-------------|
| `INTERNAL_API_KEY` | Hub + Agent | yes | Shared secret for agent auth. Hub validates, agent sends. |
| `JWT_SECRET` | Hub | yes | Secret for JWT verification of browser tokens |
| `WEB_API_URL` | Agent | yes | Hub URL, e.g. `http://localhost:3333` |
| `WEB_BOT_ID` | Agent | yes | Bot identifier sent in handshake |
| `WEB_API_KEY` | Agent | no | Overrides `INTERNAL_API_KEY` for agent auth |

## Architecture

Bridle follows CleanSlice conventions:

```
bridle/
├── nestjs/                          # Hub server
│   ├── bridle.module.ts             # NestJS module (ConfigModule + JwtModule)
│   ├── bridle.controller.ts         # HTTP endpoints (/:botId scoped)
│   ├── bridle.chat-ws.ts            # Browser WebSocket (JWT auth)
│   ├── bridle.agent-ws.ts           # Agent WebSocket (apiKey auth)
│   ├── domain/
│   │   ├── bridle.types.ts          # Interfaces (IBridleClientData, etc.)
│   │   └── bridle.gateway.ts        # Abstract gateway (botId-aware)
│   ├── data/
│   │   └── bridle.gateway.ts        # Concrete implementation (per-bot maps)
│   └── dtos/
│       ├── sendMessage.dto.ts       # Request DTO
│       └── bridleHealth.dto.ts      # Response DTO
├── nuxt/                            # Chat UI
│   ├── stores/bridle.ts             # Pinia store (auth-aware connect)
│   ├── components/bridle/
│   │   ├── Provider.vue             # Chat widget (apiUrl + botId + token)
│   │   ├── Message.vue              # Message bubble
│   │   └── Input.vue                # Text input
│   └── nuxt.config.ts
├── runtime/                         # Agent client
│   └── bridle.repository.ts         # Socket.IO client (env-based auth)
└── docs/
    └── PROTOCOL.md                  # Protocol specification
```

## Design Decisions

**Stateless hub.** The hub holds no message history. Browser clients maintain their own message list. This keeps the hub simple and horizontally scalable.

**Per-bot isolation.** `agents: Map<botId, send>` and `clients: Map<clientId, { botId, send }>`. Multiple bots connect simultaneously, each scoped by `botId`. No Socket.IO rooms -- just maps with botId filtering.

**Auth in handleConnection.** NestJS WS guards only run on `@SubscribeMessage`, not on connect. Checking auth in `handleConnection` + `client.disconnect(true)` ensures unauthorized clients never receive events.

**Shared API key for agents.** All bot runtimes are deployed by the same system. `INTERNAL_API_KEY` provides authentication, `botId` provides identity. No need for per-bot tokens.

**JWT for browsers.** The admin panel already has a JWT flow. The token is passed in Socket.IO's `auth` field. Admin users (`roles: ['ADMIN']`) get `clientId = 'admin'` for runtime access control integration.

**Accumulated text streaming.** Each `stream` event contains the full text so far, not a delta. Simpler to implement (client just replaces text), trades bandwidth for correctness. Stream chunks are batched at 100ms intervals.

**Abstract gateway.** The hub logic is behind `IBridleGateway` (abstract class as DI token). The concrete `BridleGateway` can be swapped without changing the controller or WebSocket handlers.
