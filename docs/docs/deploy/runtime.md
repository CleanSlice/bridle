# Agent Runtime

The runtime is your agent process — the thing that actually talks to an LLM and replies. Bridle ships a thin client (`bridle/runtime/bridle.repository.ts`) that connects to the hub as a Socket.IO client and gives you a clean `onMessage` / `send` / `streamSend` API.

## Install the client

```bash
cp bridle/runtime/bridle.repository.ts your-agent/src/channels/bridle.repository.ts
npm install socket.io-client
```

Or import it from a shared workspace package — the implementation is one file with no other deps beyond `socket.io-client`.

## Minimal agent loop

```ts
import { BridleRepository } from './channels/bridle.repository'

const bridle = new BridleRepository(process.env.BRIDLE_URL!)

bridle.onMessage(async (msg) => {
  console.log(`[${msg.from}] ${msg.text}`)

  // Simple echo
  await bridle.send(msg.from, `You said: ${msg.text}`)
})

await bridle.start()
```

## Streaming reply

```ts
bridle.onMessage(async (msg) => {
  await bridle.streamSend(msg.from, async (onChunk) => {
    let accumulated = ''
    for await (const token of yourLlmStream(msg.text)) {
      accumulated += token
      onChunk(accumulated)         // accumulated text, not delta
    }
    return accumulated             // final value committed in stream_end
  })
})
```

The runtime batches `onChunk` calls into `stream` events at 100ms intervals and emits the final `stream_end` when the streamer resolves. See [Streaming](/protocol/streaming) for the wire protocol.

## Required environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BRIDLE_URL` | yes | Hub URL, e.g. `https://hub.example.com` (no trailing slash) |
| `BRIDLE_API_KEY` | yes | Shared secret — must match the hub's `BRIDLE_API_KEY` |
| `BRIDLE_BOT_ID` | yes | Identifier for this agent. Browsers use it in their handshake. |

The repository reads these from `process.env` on `connect()`.

## Multiple bots from one process

`BridleRepository` represents a single bot identity. To serve multiple `botId`s from one process, instantiate multiple repositories:

```ts
const support = new BridleRepository(BRIDLE_URL)
process.env.BRIDLE_BOT_ID = 'support'
support.onMessage(handleSupport)
await support.start()

const sales = new BridleRepository(BRIDLE_URL)
process.env.BRIDLE_BOT_ID = 'sales'
sales.onMessage(handleSales)
await sales.start()
```

This works but is awkward — a cleaner pattern is one process per bot, deployed separately.

## Reconnection

The Socket.IO client reconnects automatically with a 3-second backoff and infinite attempts. On reconnect, the client re-emits `register` so the hub re-registers the agent in its map.

If the hub restarts, agents reconnect within seconds. Browsers may briefly see "Disconnected" but `socket.io-client` handles their reconnect too.

## Persistence

The hub doesn't store transcripts. If you want chat history to survive page refreshes, persist messages in the runtime:

```ts
bridle.onMessage(async (msg) => {
  await persistUserMessage(msg.from, msg)
  const reply = await llm.chat(msg.text)
  await persistAgentMessage(msg.from, reply)
  await bridle.send(msg.from, reply)
})
```

Then implement the transcript HTTP endpoint in your hub by reading from your store (instead of the default empty array). The Bridle reference repo has a no-op transcript abstraction (`IBridleTranscriptGateway`) you can override.

## Identifying admin users

If a JWT contained `roles: ['ADMIN']`, the hub overrides `clientId` to `'admin'`. Use this for runtime access control:

```ts
bridle.onMessage(async (msg) => {
  const isAdmin = msg.from === 'admin'
  if (isAdmin) {
    // expanded tool set, internal commands, etc.
  }
})
```

## Health

The runtime doesn't expose its own HTTP endpoint by default — the hub's `/api/agent/:botId/health` reflects whether the runtime is connected. For deeper health checks (LLM provider connectivity, queue depth), add your own endpoint to the runtime process.
