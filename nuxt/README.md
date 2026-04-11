# Bridle Chat UI (Nuxt)

Drop-in webchat widget for Bridle. Connects to the hub via Socket.IO with JWT authentication, manages state through a Pinia store, and renders rich message parts (text, images, files).

## Dependencies

| Package | Purpose |
|---------|---------|
| `socket.io-client` | WebSocket connection to Bridle hub |
| `pinia` | State management (auto-imported by Nuxt) |
| `lucide-vue-next` | Icons (Bot, User, Send, FileText) |

Theme dependencies (from `#theme` alias -- your app's shadcn-vue theme slice):

| Component | Import |
|-----------|--------|
| `Card`, `CardContent`, `CardFooter`, `CardHeader` | `#theme/components/ui/card` |
| `ScrollArea` | `#theme/components/ui/scroll-area` |
| `Textarea` | `#theme/components/ui/textarea` |
| `Button` | `#theme/components/ui/button` |
| `cn` | `#theme/utils/cn` |

```bash
npm i socket.io-client lucide-vue-next
```

## Setup

This slice is a Nuxt layer. Add it to your app's config:

```typescript
// app/nuxt.config.ts
export default defineNuxtConfig({
  extends: ['./slices/bridle'],
})
```

The slice registers a `#bridle` alias and auto-imports its components.

## Usage

```vue
<template>
  <BridleProvider
    api-url="http://localhost:3333"
    bot-id="bot-abc-123"
    :token="authToken"
  />
</template>
```

## Components

### `BridleProvider`

Full chat widget. Handles connection lifecycle, message display, and input.

**Props:**

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `apiUrl` | string | yes | -- | Bridle hub URL |
| `botId` | string | yes | -- | Which bot to chat with |
| `token` | string | yes | -- | JWT token for authentication |
| `title` | string | no | `'Agent Chat'` | Header title |
| `placeholder` | string | no | `'Type a message...'` | Input placeholder |
| `class` | string | no | -- | Additional CSS classes on the card |
| `showStatus` | boolean | no | `true` | Show connection status indicator |

Connects on mount, disconnects on unmount. Shows a typing indicator when the agent is processing.

### `BridleMessage`

Renders a single message bubble with rich parts.

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `message` | `IBridleMessageData` | Message object with `text`, `parts[]`, `role` |

Renders each part type:
- **Text** -- `<p>` with `whitespace-pre-wrap`
- **Image** -- `<img>` with base64 data URI
- **File** -- download link with file icon
- Falls back to plain `text` if `parts` is empty

### `BridleInput`

Text input with send button. Enter sends, Shift+Enter for newline.

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `placeholder` | string | Input placeholder text |
| `disabled` | boolean | Disable input (e.g. when disconnected) |

**Events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `send` | `string` | Emitted when user sends a message |

## Store

```typescript
const store = useBridleStore()

// Connect with auth
store.connect('http://localhost:3333', 'bot-abc-123', jwtToken)

// Send a message (builds parts from text automatically)
store.sendMessage('Hello')

// Send with images
store.sendMessage('Check this out', [
  { base64: '...', mediaType: 'image/jpeg' },
])

// Disconnect
store.disconnect()

// UI toggle
store.open()
store.close()
store.toggle()

// Clear history
store.clearMessages()
```

### Reactive State

| Property | Type | Description |
|----------|------|-------------|
| `messages` | `IBridleMessageData[]` | All messages (each has `.text` + `.parts[]`) |
| `isConnected` | `boolean` | WebSocket connection status |
| `isTyping` | `boolean` | Agent is generating a response |
| `isOpen` | `boolean` | UI open/closed state (for toggle widgets) |
| `clientId` | `string \| null` | Assigned by hub on `welcome` event |

### Connection Handling

The store passes `{ token, botId }` in the Socket.IO auth handshake. If the JWT is invalid or expired, the hub disconnects the client immediately. The store handles `connect_error` -- `isConnected` stays `false` and the error is logged.

Auto-reconnect is enabled with a 2-second delay.

## Message Parts

Messages carry a `parts: BridlePart[]` array for rich content:

```typescript
enum BridlePartTypes {
  Text = 'text',
  Image = 'image',
  File = 'file',
}

type BridlePart =
  | { type: 'text', text: string }
  | { type: 'image', base64: string, mediaType: string }
  | { type: 'file', url: string, name: string, mimeType?: string }
```

When sending, the store builds parts from `text` + `images` via `buildParts()`. When receiving, parts come from the hub. The `Message.vue` component renders each type appropriately.

## Socket.IO Events

The store listens for these events from the hub:

| Event | Handled by | Description |
|-------|-----------|-------------|
| `welcome` | Sets `clientId` | Connection confirmed |
| `message` | Pushes to `messages` | Complete response with `text` + `parts` |
| `typing` | Sets `isTyping = true` | Agent started processing |
| `stream` | Updates/pushes message | Accumulated text + parts (replace, not append) |
| `stream_end` | Finalizes message | Streaming complete, `streaming = false` |
| `connect` | Sets `isConnected = true` | Socket connected |
| `disconnect` | Sets `isConnected = false` | Socket disconnected |
| `connect_error` | Logs error | Auth failure or network error |

The store emits:

| Event | Payload | When |
|-------|---------|------|
| `message` | `{ text, parts }` | User sends a message |
| `ping` | `{}` | Keepalive (manual) |

## File Structure

```
nuxt/
├── nuxt.config.ts                     # Layer config (#bridle alias, component auto-import)
├── stores/
│   └── bridle.ts                      # Pinia store (connect, send, state)
└── components/
    └── bridle/
        ├── Provider.vue               # Full chat widget
        ├── Message.vue                # Message bubble (renders parts)
        ├── Input.vue                  # Text input + send button
        └── index.ts                   # Re-exports components
```

## Exports

```typescript
// Store
useBridleStore          // Pinia store composable

// Types
IBridleMessageData      // { id, role, text, parts[], ts, streaming? }
BridlePartTypes         // Enum: Text, Image, File
BridlePart              // Union type for parts
IBridleTextPart         // { type: 'text', text }
IBridleImagePart        // { type: 'image', base64, mediaType }
IBridleFilePart         // { type: 'file', url, name, mimeType? }

// Components
BridleProvider          // Full chat widget
BridleMessage           // Single message bubble
BridleInput             // Text input
```

## Protocol

See [PROTOCOL.md](../docs/PROTOCOL.md) for the full wire format, event schemas, and streaming model.
