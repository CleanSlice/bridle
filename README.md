# Bridle

Webchat relay for AI agents. Bridle connects browser users to an agent runtime through a stateless NestJS hub, with a ready-made Nuxt chat UI and an agent-side Socket.IO client.

```
Browser (Nuxt)               Bridle Hub (NestJS)           Agent Runtime
     |                             |                             |
     |--- Socket.IO /ws/chat ----->|                             |
     |                             |--- Socket.IO /ws/agent ---->|
     |                             |                             |
     |<--- stream/message ---------|<--- stream/message ---------|
```

The hub is **stateless** -- it holds no message history. It routes messages between browsers and the agent in real time using Socket.IO.

## Packages

| Directory | Description | Stack |
|-----------|-------------|-------|
| `nestjs/` | Hub server -- WebSocket relay + HTTP fallback | NestJS, Socket.IO |
| `nuxt/` | Chat UI -- drop-in component + Pinia store | Nuxt 3, Vue 3, shadcn-vue |
| `runtime/` | Agent client -- connects to the hub as a channel | Socket.IO client |

## Hub Server (NestJS)

The hub exposes two WebSocket namespaces and an HTTP API:

| Endpoint | Purpose |
|----------|---------|
| `/ws/chat` | Browser clients connect here |
| `/ws/agent` | Agent runtime connects here |
| `POST /api/agent/message` | HTTP fire-and-forget message |
| `POST /api/agent/message/sync` | HTTP synchronous message (120s timeout) |
| `GET /api/agent/health` | Connection status |

### Usage

```typescript
// app.module.ts
import { BridleModule } from 'bridle/nestjs'

@Module({
  imports: [BridleModule],
})
export class AppModule {}
```

### Exports

```typescript
// Module
BridleModule

// Domain (abstract gateway + types)
IBridleGateway          // Abstract class -- DI token
IBridleHealthData       // { ok, agentConnected, browserClients }
IBridleImageData        // { base64, mediaType }
IBridleIncomingMessage  // Hub -> Agent message
IBridleOutgoingEvent    // Agent -> Hub event

// Data (concrete implementation)
BridleGateway           // Hub implementation

// Presentation
BridleController        // HTTP endpoints
ChatWsGateway           // Browser WebSocket handler
AgentWsGateway          // Agent WebSocket handler

// DTOs
SendMessageDto          // Request body for /api/agent/message
BridleHealthDto         // Response for /api/agent/health
```

## Chat UI (Nuxt)

A drop-in chat widget built with shadcn-vue. Connects to the hub via Socket.IO and manages all state through a Pinia store.

### Usage

Add the slice as a Nuxt layer, then use the component:

```vue
<script setup lang="ts">
// Provider.vue handles connect/disconnect lifecycle via the store
</script>

<template>
  <BridleProvider api-url="http://localhost:3333" />
</template>
```

### Components

| Component | File | Description |
|-----------|------|-------------|
| `BridleProvider` | `components/bridle/Provider.vue` | Full chat widget -- connection, messages, input |
| `BridleMessage` | `components/bridle/Message.vue` | Single message bubble (user or assistant) |
| `BridleInput` | `components/bridle/Input.vue` | Text input with send button |

### Store

```typescript
const store = useBridleStore()

store.connect('http://localhost:3333') // Connect to hub
store.sendMessage('Hello')            // Send a message
store.disconnect()                    // Disconnect

// Reactive state
store.messages     // IBridleMessageData[]
store.isConnected  // boolean
store.isTyping     // boolean
store.isOpen       // boolean (for toggle UI)
```

### Nuxt Config

The slice registers a `#bridle` alias:

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['./path/to/bridle/nuxt'],
})
```

## Agent Client (Runtime)

`BridleRepository` connects to the hub as a Socket.IO client and implements the `IChannelGateway` interface. Use it in your agent runtime to receive browser messages and stream responses back.

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

See [PROTOCOL.md](./PROTOCOL.md) for the full specification including:

- WebSocket event schemas for both connections
- HTTP API request/response formats
- Streaming model (accumulated text, not deltas)
- Sequence diagrams for all message flows
- TypeScript type definitions

## Environment Variables

| Variable | Where | Required | Description |
|----------|-------|----------|-------------|
| `WEB_API_URL` | Agent | yes | Hub URL, e.g. `http://localhost:3333` |
| `WEB_API_KEY` | Agent | no | API key for agent auth handshake |
| `WEB_BOT_ID` | Agent | no | Bot identifier for agent auth handshake |

## Architecture

Bridle follows CleanSlice conventions:

```
bridle/
├── nestjs/                          # Hub server
│   ├── bridle.module.ts             # NestJS module
│   ├── bridle.controller.ts         # HTTP endpoints
│   ├── bridle.chat-ws.ts            # Browser WebSocket
│   ├── bridle.agent-ws.ts           # Agent WebSocket
│   ├── domain/
│   │   ├── bridle.types.ts          # Interfaces
│   │   └── bridle.gateway.ts        # Abstract gateway (DI token)
│   ├── data/
│   │   └── bridle.gateway.ts        # Concrete implementation
│   └── dtos/
│       ├── sendMessage.dto.ts       # Request DTO
│       └── bridleHealth.dto.ts      # Response DTO
├── nuxt/                            # Chat UI
│   ├── stores/bridle.ts             # Pinia store + Socket.IO client
│   ├── components/bridle/
│   │   ├── Provider.vue             # Chat widget
│   │   ├── Message.vue              # Message bubble
│   │   └── Input.vue                # Text input
│   └── nuxt.config.ts
├── runtime/                         # Agent client
│   └── bridle.repository.ts         # Socket.IO client for agent
└── PROTOCOL.md                      # Protocol specification
```

## Design Decisions

**Stateless hub.** The hub holds no message history. Browser clients maintain their own message list. This keeps the hub simple and horizontally scalable.

**Accumulated text streaming.** Each `stream` event contains the full text so far, not a delta. Simpler to implement (client just replaces text), trades bandwidth for correctness. Stream chunks are batched at 100ms intervals.

**Single agent.** Only one agent can be connected at a time. The hub routes all browser messages to that agent and all agent responses back to the correct browser via `clientId`.

**Abstract gateway.** The hub logic is behind `IBridleGateway` (abstract class as DI token). The concrete `BridleGateway` can be swapped without changing the controller or WebSocket handlers.
