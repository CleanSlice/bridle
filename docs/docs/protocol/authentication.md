# Authentication

Both sides of the relay authenticate in the WebSocket handshake. Auth is checked in `handleConnection` — unauthorized clients are disconnected immediately, before any events are processed.

## Agent → Hub (apiKey + agentId)

Agent runtimes prove identity with a shared API key and declare which bot they serve:

```ts
import { io } from 'socket.io-client'

io('https://your-hub.example.com/ws/agent', {
  auth: {
    apiKey: process.env.BRIDLE_API_KEY,  // shared secret
    agentId: process.env.BRIDLE_AGENT_ID,    // which bot this agent serves
  },
})
```

The hub validates `apiKey` against the `BRIDLE_API_KEY` environment variable. If the key is missing or wrong, the connection is rejected. `agentId` is required — it scopes all message routing to that bot.

## Browser → Hub (JWT + agentId)

Browser clients authenticate with a JWT and specify which bot to chat with:

```ts
io('https://your-hub.example.com/ws/client', {
  auth: {
    token: 'eyJhbG...',                  // JWT from your backend
    agentId: 'agent-abc-123',                // which bot to chat with
  },
})
```

(The SDK does this for you — you provide the token via `data-token` or the `token` option.)

The hub verifies the JWT using NestJS `JwtService` with `JWT_SECRET`. Two claims matter:

| JWT claim | Used as | Notes |
|-----------|---------|-------|
| `sub` | `clientId` for routing | Required |
| `email` | Stored in socket data | Optional, used for logging |
| `roles` | Admin promotion | If includes `'ADMIN'`, the hub sets `clientId = 'admin'` |

### Minimal example (Node.js)

```ts
import jwt from 'jsonwebtoken'

const token = jwt.sign(
  {
    sub: user.id,
    email: user.email,
    roles: user.isAdmin ? ['ADMIN'] : [],
  },
  process.env.JWT_SECRET,
  { expiresIn: '1h' },
)
```

Use a short expiry — the SDK reconnects automatically and your token-getter function (`token: () => fetchJwt()`) will be called again on reconnect, so refresh is transparent.

## Admin clients

When `roles` includes `'ADMIN'`, the hub overrides `clientId` to the literal string `'admin'`. This lets agent runtimes distinguish admin users in their access control:

```ts
// In the agent runtime
if (msg.from === 'admin') {
  // This user has admin privileges
}
```

Admin clients also receive admin-only events such as the optional debug stream (LLM prompt traces) — the embedded SDK doesn't surface these, but the Nuxt admin layer in the Bridle repo does.

## Why `handleConnection`?

NestJS WebSocket guards (`@UseGuards`) only run on `@SubscribeMessage` handlers. By that point, an unauthorized client has already established a connection and could receive broadcast events. Bridle checks credentials in `handleConnection` and calls `client.disconnect(true)` immediately on failure.

```ts
// bridleAgentWs.handler.ts (excerpt)
async handleConnection(client: Socket) {
  const { apiKey, agentId } = client.handshake.auth
  if (!apiKey || apiKey !== this.config.get('BRIDLE_API_KEY') || !agentId) {
    client.disconnect(true)
    return
  }
  // ...register agent
}
```
