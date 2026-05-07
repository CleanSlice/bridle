# How It Works

A walk through the moving parts so you can debug confidently.

## Three connections, one hub

```
Browser ─── /ws/client ───┐
                        │
         Bridle Hub ────┼─── /ws/agent ─── Agent runtime
                        │
HTTP fallback ──────────┘
   POST /api/agent/:agentId/message[/sync]
```

The hub is **stateless** — it holds no message history. It maintains two in-memory maps:

- `agents: Map<agentId, sendFn>` — each agent runtime registers under its `agentId`.
- `clients: Map<clientId, { agentId, sendFn, isAdmin }>` — each connected browser.

When a browser sends a message, the hub looks up the agent for that `agentId` and forwards. When the agent responds, the hub looks up the originating `clientId` and routes back. That's it.

## Per-bot isolation

Every connection — browser or agent — declares a `agentId` in the WebSocket auth handshake. The hub enforces:

- Browsers only receive responses from the agent serving their `agentId`.
- Agents only see messages from browsers asking for their `agentId`.
- Multiple bots can serve different audiences through the same hub.

```
Bot A (agentId: "bot-a")     Hub      Browser 1 (agentId: "bot-a")
Bot B (agentId: "bot-b")     Hub      Browser 2 (agentId: "bot-b")
```

## Auth is checked in `handleConnection`

NestJS WebSocket guards (`@UseGuards`) only run on `@SubscribeMessage` handlers — by that point, an unauthorized client is already connected and would receive broadcast events. Bridle checks `auth` in `handleConnection` and calls `client.disconnect(true)` immediately on failure.

- **Agents** authenticate with a shared API key (`BRIDLE_API_KEY`) plus their declared `agentId`.
- **Browsers** authenticate with a JWT signed by your app, plus the `agentId` they want to chat with.

See [Authentication](/protocol/authentication) for the JWT claim format.

## Streaming model

The agent calls `streamSend(clientId, async (onChunk) => { ... })`. Inside the streamer, it calls `onChunk(accumulated)` with the **full text so far** (not a delta). Bridle batches these into `stream` events every 100ms and sends a final `stream_end` when the streamer resolves.

Why accumulated text instead of deltas?

- Simpler client: just replace the message text on each `stream` event.
- Resilient to dropped events: a missed chunk doesn't desync the rendered text.
- Trade-off: more bandwidth. In practice, the trade is worth it for chat UIs.

## Rich message parts

Every message carries a `parts: BridlePart[]` array alongside a plain `text` shorthand. A part is one of:

```ts
{ type: 'text',  text: 'Hello' }
{ type: 'image', base64: '...', mediaType: 'image/jpeg' }
{ type: 'file',  url: 'https://...', name: 'doc.pdf', mimeType: 'application/pdf' }
```

Parts flow end-to-end: browser → hub → agent → hub → browser. The SDK renders each type — text as paragraphs, images inline, files as download links.

## What survives a refresh

Bridle is stateless on the wire, but the hub exposes an HTTP endpoint to read the agent's persisted transcript:

```
GET /api/agent/:agentId/transcript?channel=web
```

When the SDK mounts, it pulls the saved transcript so the chat isn't blank between page loads. New messages arrive over WebSocket as before. Persistence is **agent-side** — Bridle's hub stays stateless. The runtime decides where to write (local file, S3, database).

## What stays in the browser

The SDK persists nothing by default — refreshes go straight to the transcript endpoint. Custom integrations can add localStorage caching themselves around the headless client.

## What's NOT in the embedded SDK

The SDK is built for end users on public sites. These features are in the Nuxt layer (`bridle/nuxt/`) but intentionally not in the embed bundle:

- Admin-only **debug panel** (LLM prompt traces, tool calls, token usage).
- Admin **sync** command (push agent's local files to S3).
- Markdown rendering (the embed renders plain text — keeps the bundle small).

If you want those, use the Nuxt layer directly inside an admin Nuxt app. The embed is for visitors; the Nuxt layer is for operators.
