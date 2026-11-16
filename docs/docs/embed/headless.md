# Headless Client

When you don't want the built-in widget UI and would rather render your own. The `BridleClient` gives you the wire-level connection — events in, `send()` out — and stays out of your way.

## Install

```bash
bun add @cleanslice/bridle
# or: npm i / pnpm add / yarn add @cleanslice/bridle
```

## Usage

```ts
import { BridleClient } from '@cleanslice/bridle'

const client = new BridleClient({
  apiUrl: 'https://your-hub.example.com',
  agentId: 'agent-abc-123',
  token: 'eyJhbG...',           // string or () => string | Promise<string>
})

client.on('open', () => console.log('connected'))
client.on('close', () => console.log('disconnected'))
client.on('error', (err) => console.error(err))

client.on('message', (m) => {
  // Final, complete agent message.
  console.log('[assistant]', m.text)
})

client.on('stream', (m) => {
  // Partial agent text — accumulated, not delta. Replace whatever is rendered.
  console.log('[partial]', m.text)
})

client.on('stream_end', (m) => {
  // Stream finished; m.text is the final value.
  console.log('[done]', m.text)
})

client.on('typing', () => {
  // Agent indicated it's thinking.
})

await client.connect()
client.send('Hello')
```

## API

### `new BridleClient(options)`

```ts
interface IBridleClientOptions {
  apiUrl: string
  agentId: string
  token: string | (() => string | Promise<string>)
  // Optional: your own token source, used instead of `token`. `force: true`
  // must bypass any cache (the hub just rejected the current token).
  getToken?: (options?: { force?: boolean }) => Promise<string>
  canRefreshToken?: boolean // default: true with getToken, "token is a function" otherwise
  channel?: string         // optional; default 'web'
}
```

### `client.authorizedFetch(url, init?): Promise<Response>`

`fetch` against the hub with the current token as `Authorization: Bearer`. On `401` it renews the token (when it can) and retries once. Use it for the HTTP endpoints, e.g. `/api/agent/:id/transcript`.

### `client.connect(): Promise<void>`

Opens the WebSocket. Resolves immediately after `socket.connect()` is called — the actual `open` event fires asynchronously via the listener.

### `client.send(text, parts?, options?): Promise<BridleSendOutcome>`

Sends a user message to the agent. If `parts` is omitted, a text-only part is constructed from `text`. To send rich content (images, files), pass parts explicitly:

```ts
client.send('See this image', [
  { type: 'text', text: 'See this image' },
  { type: 'image', base64: '...', mediaType: 'image/png' },
])
```

Since 0.16.0 every send carries a `clientMessageId` (yours via `options.clientMessageId`, otherwise minted) and asks the hub to acknowledge it. The returned promise resolves with the answer and **never rejects**, so code that ignores it — `client.send('Hello')` — works as before. It still throws synchronously when called before `connect()`.

```ts
type BridleSendOutcome =
  | { status: 'accepted'; messageId: string; ts?: number; duplicate?: boolean }
  | { status: 'rejected'; code: string; message?: string; retryAfterMs?: number; window?: 'minute' | 'hour' | 'day' }
  | { status: 'unacknowledged'; messageId: string }
```

| Outcome | Meaning | What the client does besides resolving |
|---------|---------|----------------------------------------|
| `accepted` | Forwarded to the agent | — |
| `rejected` `RATE_LIMITED` | The agent's [request limit](/protocol/websocket#request-limits) is full | Fires `limit`; holds sending until the wait is over |
| `rejected` `AGENT_OFFLINE` | No runtime is connected for this agent | Fires `message` with "Agent is not connected. Please try again later." — the line a hub sends to clients it cannot acknowledge |
| `rejected`, any other code | Not delivered (`ATTACHMENT_FAILED`, `SHARE_REJECTED`, `EMPTY`, …) | — |
| `unacknowledged` | The hub did not answer within 10 s. It does not acknowledge (the reference hub, older builds) and took the message as it always did | — |

**While limited, `send()` sends nothing**: it fires `limit` again with the remaining wait and resolves `rejected` / `RATE_LIMITED`. Take the message out of your UI and give the text back to the person — do not queue it to fire when the wait ends.

```ts
const outcome = await client.send(text)
if (outcome.status === 'rejected' && outcome.code === 'RATE_LIMITED') {
  restoreDraft(text)   // the countdown comes from the `limit` event
}
```

### `client.getLimit(): IBridleLimitState`

`{ limited: false }`, or `{ limited: true, retryAfterMs, window? }` with what is left of the wait right now. The deadline is kept on `performance.now()`, so a wrong wall clock or a background tab does not distort it — call this (for instance on `visibilitychange`) rather than counting down from the number you were given.

### `client.disconnect(): void`

Closes the WebSocket. Idempotent.

### `client.on(event, handler)`

Subscribe to events:

| Event | Payload | When |
|-------|---------|------|
| `open` | — | Socket connected and authed |
| `close` | — | Socket disconnected |
| `error` | `Error` | Connection error |
| `welcome` | `{ clientId: string }` | Hub assigned a clientId |
| `typing` | — | Agent is typing |
| `message` | `IBridleMessage` | Final agent message |
| `stream` | `IBridleMessage` | Partial agent text (accumulated, not delta) |
| `stream_end` | `IBridleMessage` | Streaming finished |
| `limit` | `{ limited: boolean, retryAfterMs?: number, window?: 'minute' \| 'hour' \| 'day' }` | The agent's request limit is full (`limited: true`: a send was refused, the hub announced a full hour or day window, or `send()` was called during the wait) or sending is open again (`limited: false`: the wait ran out, or the hub made room early) |

A full limit is an expected state. It is reported through `limit` only — never through `error`, and never as a `BridleAuthError`.

### `client.off(event, handler)`

Remove a previously-attached listener.

### `client.getClientId(): string | null`

Returns the server-assigned `clientId` after the `welcome` event, otherwise `null`.

## Event ordering

A typical streaming response from the agent looks like:

```
typing
stream      { messageId: 'm-1', text: 'Hello' }
stream      { messageId: 'm-1', text: 'Hello, how' }
stream      { messageId: 'm-1', text: 'Hello, how can' }
stream_end  { messageId: 'm-1', text: 'Hello, how can I help?' }
```

A non-streaming response:

```
typing
message     { messageId: 'm-2', text: 'Hello, how can I help?' }
```

Handle both — agents may stream some responses and not others (e.g., quick canned replies, tool-call results).

## Reconnect behavior

The underlying `socket.io-client` reconnects automatically on disconnect (network drop, sleep, hub restart), and every handshake asks for the current token.

With a **function** `token` the client renews on its own: it caches the token until ~60 s before its `exp`, refreshes it then, and when the hub still rejects a token (`bridle_error` `TOKEN_EXPIRED` / `INVALID_TOKEN`, after which the hub drops the socket) it calls the function again and reconnects. A renewed token that is rejected again within 30 s is reported through `error` as a `BridleAuthError` — no retry loop.

With a **string** `token` nothing can be renewed: the rejection arrives as a `BridleAuthError` with `code: 'TOKEN_EXPIRED'` (or `'INVALID_TOKEN'`). Create a new client with a fresh token to continue.

## When to use headless vs the widget

- **Use the widget** for marketing sites, support chats, anything where the built-in UI is fine.
- **Use headless** when you have a custom message renderer (e.g., showing tool calls, images with captions, agent step traces) or need to integrate with an existing chat UI in your app.
