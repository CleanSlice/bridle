# Deploy the Hub

The hub is a NestJS app that relays messages between browsers and agents. It's stateless, so deployment is straightforward — drop it on any container platform.

## What lives in `bridle/nestjs/`

```
bridle/nestjs/
├── bridle.module.ts          # NestJS module
├── bridle.controller.ts      # HTTP endpoints (/:botId scoped)
├── handlers/
│   ├── bridleChatWs.handler.ts   # /ws/chat (browser, JWT auth)
│   └── bridleAgentWs.handler.ts  # /ws/agent (agent, apiKey auth)
├── domain/
│   ├── bridle.types.ts       # Wire protocol types
│   └── bridle.gateway.ts     # Abstract gateway (DI token)
├── data/
│   └── bridle.gateway.ts     # In-memory implementation
└── dtos/
```

## Integrating into a CleanSlice API

If you already have a NestJS app following CleanSlice conventions, drop the slice in:

```bash
cp -r bridle/nestjs api/src/slices/bridle
```

Wire it up in `app.module.ts`:

```ts
import { BridleModule } from './slices/bridle/bridle.module'

@Module({
  imports: [BridleModule],
})
export class AppModule {}
```

Install dependencies:

```bash
npm i @nestjs/websockets @nestjs/platform-socket.io socket.io @nestjs/jwt
```

## Running standalone

If you don't have a NestJS app, the bridle hub also runs as a standalone service. The repo includes a minimal `main.ts`:

```bash
cd bridle/nestjs
npm install
npm run build
node dist/main.js
```

Default port is `3333`. Override with `PORT=4000`.

## Required environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BRIDLE_API_KEY` | yes | Shared secret agents present at handshake. Generate with `openssl rand -hex 32`. |
| `JWT_SECRET` | yes | Secret used to verify browser JWTs. Must match the secret your app signs with. |
| `PORT` | no | Default `3333`. |
| `CORS_ORIGINS` | recommended | Comma-separated list of origins allowed to connect (e.g., `https://your-site.com,https://app.your-site.com`). Default `*` is fine for development but not production. |

## Production checklist

1. **HTTPS / WSS only.** Never serve `BRIDLE_API_KEY` or JWTs over plain HTTP. Put the hub behind a TLS-terminating proxy (nginx, Caddy, your cloud's load balancer).
2. **Set `CORS_ORIGINS` explicitly.** Wildcard origins on a hub serving many sites is a foot-gun.
3. **Rotate `BRIDLE_API_KEY` periodically.** All agent runtimes need to update at the same time — coordinate with a rolling deploy.
4. **Use short-lived JWTs.** 1 hour is a reasonable default. Token-getter functions in the SDK refresh transparently on reconnect.
5. **Run multiple replicas.** The hub is stateless, but Socket.IO clients pin to a single replica per session — make sure your load balancer uses **sticky sessions** or **Redis adapter** if you scale horizontally.

## Sticky sessions or Redis

For horizontal scaling:

- **Sticky sessions** (`ip_hash` in nginx, source affinity in your cloud LB) keeps a connected browser/agent pinned to one replica. Simplest, works with `In-Memory` gateway.
- **Redis adapter** (`@socket.io/redis-adapter`) fans out events across replicas. Required if a browser and the agent for its `botId` land on different replicas.

For most deployments, sticky sessions are enough — agents are long-lived, browsers reconnect from scratch, and you can put both on the same replica.

## Health probes

Configure your platform's liveness probes against:

```
GET /api/agent/health
```

Returns `{ ok: true, ... }` always — non-200 only on a hard failure (process crash). For readiness, check `/api/agent/:botId/health` returning `agentConnected: true`.

## Logs

The hub logs every connection, registration, and disconnect at INFO level. Sensitive fields (JWT, API key) are not logged. For production, use a structured logger (`nest-pino` or similar) and ship to your aggregator.
