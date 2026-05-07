# Headless Client

When you don't want the built-in widget UI and would rather render your own. The `BridleClient` gives you the wire-level connection — events in, `send()` out — and stays out of your way.

## Install

```bash
npm i @cleanslice/bridle
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
  channel?: string         // optional; default 'web'
}
```

### `client.connect(): Promise<void>`

Opens the WebSocket. Resolves immediately after `socket.connect()` is called — the actual `open` event fires asynchronously via the listener.

### `client.send(text: string, parts?: BridlePart[]): void`

Sends a user message to the agent. If `parts` is omitted, a text-only part is constructed from `text`. To send rich content (images, files), pass parts explicitly:

```ts
client.send('See this image', [
  { type: 'text', text: 'See this image' },
  { type: 'image', base64: '...', mediaType: 'image/png' },
])
```

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

The underlying `socket.io-client` reconnects automatically on disconnect. If your token has expired, the next reconnect will fail with `error: 'invalid token'` — fetch a fresh token and call `disconnect()` then `connect()` to retry with the new one. If you passed a function as `token`, simply `disconnect(); connect();` is enough — the function is called again.

## When to use headless vs the widget

- **Use the widget** for marketing sites, support chats, anything where the built-in UI is fine.
- **Use headless** when you have a custom message renderer (e.g., showing tool calls, images with captions, agent step traces) or need to integrate with an existing chat UI in your app.
