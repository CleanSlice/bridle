# Bridle Hub Server (NestJS)

Stateless WebSocket relay that routes messages between browser clients and bot agents. Supports multiple bots simultaneously, each scoped by `botId`.

## Dependencies

| Package | Purpose |
|---------|---------|
| `@nestjs/websockets` | WebSocket gateway decorators |
| `@nestjs/platform-socket.io` | Socket.IO adapter for NestJS |
| `socket.io` | WebSocket transport |
| `@nestjs/jwt` | JWT verification for browser auth |
| `@nestjs/config` | Environment variable access (`BRIDLE_API_KEY`) |
| `class-validator` | DTO validation |
| `class-transformer` | DTO transformation |

```bash
npm i @nestjs/websockets @nestjs/platform-socket.io socket.io @nestjs/jwt @nestjs/config class-validator class-transformer
```

## Setup

```typescript
// app.module.ts
import { BridleModule } from 'bridle/nestjs'

@Module({
  imports: [BridleModule],
})
export class AppModule {}
```

`BridleModule` registers `ConfigModule` and `JwtModule` internally. Your app must provide `BRIDLE_API_KEY` and `JWT_SECRET` as environment variables.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BRIDLE_API_KEY` | yes | Shared secret -- agents must send this to connect |
| `JWT_SECRET` | yes | Secret for verifying browser JWT tokens |

## Authentication

Auth is enforced in `handleConnection` -- unauthorized clients are disconnected immediately, before any events are processed.

### Agent auth (`apiKey` + `botId`)

Agents connect to `/ws/agent` with credentials in the Socket.IO handshake:

```typescript
io('http://hub-host/ws/agent', {
  auth: {
    apiKey: process.env.BRIDLE_API_KEY,
    botId: process.env.BRIDLE_BOT_ID,
  },
})
```

The hub validates `apiKey` against `BRIDLE_API_KEY`. Both `apiKey` and `botId` are required -- missing or mismatched values reject the connection.

### Browser auth (JWT + `botId`)

Browsers connect to `/ws/chat` with a JWT and target bot:

```typescript
io('http://hub-host/ws/chat', {
  auth: {
    token: 'eyJhbG...',
    botId: 'bot-abc-123',
  },
})
```

The hub verifies the JWT via `JwtService`. The token payload determines identity:

| JWT field | Usage |
|-----------|-------|
| `sub` | Used as `clientId` for message routing |
| `email` | Stored in socket data for logging |
| `roles` | If includes `'ADMIN'`, `clientId` is set to `'admin'` |

### Admin detection

When the JWT contains `roles: ['ADMIN']`, the hub sets `clientId = 'admin'` instead of `sub`. This lets the agent runtime recognize admin users via `msg.from === 'admin'`.

### Per-bot isolation

Each agent registers with a `botId`. Browsers also declare a `botId`. The hub enforces isolation -- messages only flow between matching `botId` pairs. Multiple bots can serve different users through the same hub simultaneously.

### Why `handleConnection`, not NestJS guards?

NestJS WebSocket guards (`@UseGuards`) only run on `@SubscribeMessage` handlers, not on the initial connection. Checking credentials in `handleConnection` and calling `client.disconnect(true)` is simpler and more secure.

## HTTP API

| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /api/agent/:botId/message` | Bearer token | Fire-and-forget -- sends message to bot, returns `{ ok: true }` |
| `POST /api/agent/:botId/message/sync` | Bearer token | Synchronous -- waits for bot response (120s timeout) |
| `GET /api/agent/health` | -- | Overall hub status |
| `GET /api/agent/:botId/health` | -- | Per-bot connection status |

### Request body (message endpoints)

```json
{
  "text": "Hello, agent",
  "parts": [
    { "type": "text", "text": "Hello, agent" },
    { "type": "image", "base64": "<base64>", "mediaType": "image/jpeg" }
  ]
}
```

`parts` is optional. If omitted, built from `text` + `images` (legacy).

### Health response (`/api/agent/health`)

```json
{
  "ok": true,
  "agentConnected": true,
  "browserClients": 3
}
```

### Bot health response (`/api/agent/:botId/health`)

```json
{
  "ok": true,
  "agentConnected": true,
  "browserClients": 1,
  "botId": "bot-abc-123"
}
```

## WebSocket Events

### `/ws/agent` (Agent <-> Hub)

**Hub -> Agent:**

| Event | Payload | Description |
|-------|---------|-------------|
| `message` | `{ type, clientId, text, parts, messageId }` | Browser user sent a message |
| `pong` | `{}` | Response to agent's `ping` |

**Agent -> Hub:**

| Event | Payload | Description |
|-------|---------|-------------|
| `register` | `{}` | Agent announces readiness |
| `message` | `{ clientId, text, parts, messageId, ts }` | Complete response |
| `stream` | `{ clientId, text, parts, messageId, ts }` | Partial response (accumulated) |
| `stream_end` | `{ clientId, text, parts, messageId, ts }` | Final streaming chunk |
| `typing` | `{ clientId, ts }` | Typing indicator |
| `ping` | `{}` | Keepalive |

### `/ws/chat` (Browser <-> Hub)

**Browser -> Hub:**

| Event | Payload | Description |
|-------|---------|-------------|
| `message` | `{ text, parts?, images? }` | Send message to bot |
| `ping` | `{}` | Keepalive |

**Hub -> Browser:**

| Event | Payload | Description |
|-------|---------|-------------|
| `welcome` | `{ clientId }` | Sent on connection |
| `message` | `{ type, text, parts, messageId, ts }` | Complete response |
| `stream` | `{ type, text, parts, messageId, ts }` | Partial response (accumulated, not delta) |
| `stream_end` | `{ type, text, parts, messageId, ts }` | Final streaming chunk |
| `typing` | `{ type, ts }` | Typing indicator |
| `pong` | `{ ts }` | Response to `ping` |

## File Structure

```
nestjs/
├── bridle.module.ts                    # NestJS module (ConfigModule + JwtModule)
├── bridle.controller.ts                # HTTP endpoints (/api/agent/...)
├── index.ts                            # Re-exports everything
├── domain/
│   ├── bridle.gateway.ts               # Abstract gateway (DI token)
│   ├── bridle.types.ts                 # Interfaces (IBridleIncomingMessage, etc.)
│   └── index.ts
├── data/
│   ├── bridle.gateway.ts               # Concrete gateway (per-bot routing maps)
│   └── index.ts
├── handlers/
│   ├── bridleAgentWs.handler.ts        # /ws/agent WebSocket handler
│   ├── bridleChatWs.handler.ts         # /ws/chat WebSocket handler
│   └── index.ts
└── dtos/
    ├── sendMessage.dto.ts              # Request DTO (text + images)
    ├── bridleHealth.dto.ts             # Health response DTOs (BridleHealthDto + BridleBotHealthDto)
    └── index.ts
```

## Exports

```typescript
// Module
BridleModule

// Domain (abstract gateway + types)
IBridleGateway          // Abstract class -- DI token
IBridleHealthData       // { ok, agentConnected, browserClients }
IBridleBotHealthData    // { ok, agentConnected, browserClients, botId }
IBridleIncomingMessage  // Hub -> Agent message (includes botId + parts)
IBridleOutgoingEvent    // Agent -> Hub event (includes parts)
IBridleClientData       // { botId, send } -- registered client metadata
BridlePartTypes         // Enum: Text, Image, File
BridlePart              // Union type for wire parts

// Data (concrete implementation)
BridleGateway           // Hub implementation with per-bot maps

// Presentation
BridleController        // HTTP endpoints (/:botId scoped)
BridleAgentWsHandler    // Agent WebSocket handler (apiKey auth)
BridleChatWsHandler     // Browser WebSocket handler (JWT auth)

// DTOs
SendMessageDto          // Request body (text + parts + legacy images)
BridleHealthDto         // Response for /api/agent/health
BridleBotHealthDto      // Response for /api/agent/:botId/health (includes botId)
```

## Protocol

See [PROTOCOL.md](../docs/PROTOCOL.md) for the full specification including sequence diagrams, streaming model, and type definitions.
