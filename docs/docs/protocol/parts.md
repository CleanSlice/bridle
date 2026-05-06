# Message Parts

Every message — user or agent, streaming or final, WebSocket or HTTP — carries a `parts: BridlePart[]` array alongside the plain `text` shorthand. Parts are how Bridle handles rich content (images, files) without losing the simplicity of text.

## Part types

```ts
enum BridlePartTypes {
  Text = 'text',
  Image = 'image',
  File = 'file',
}
```

### Text

```ts
{ type: 'text', text: 'Hello' }
```

The bread-and-butter part. Most messages are a single text part.

### Image

```ts
{
  type: 'image',
  base64: '/9j/4AAQSkZJ...',         // raw base64 (no data: prefix)
  mediaType: 'image/jpeg',           // MIME type
}
```

Inline base64 is used for two reasons:
1. The image flows through the relay without extra storage.
2. End-to-end privacy — the image bytes never touch a CDN.

Trade-off: large images bloat the WebSocket frame. For multi-megabyte attachments, use a `file` part with a URL instead.

### File

```ts
{
  type: 'file',
  url: 'https://your-cdn.example.com/files/doc.pdf',
  name: 'invoice.pdf',
  mimeType: 'application/pdf',       // optional but recommended
}
```

The agent (or your app) uploads the file to your storage of choice (S3, R2, etc.) and sends the URL. The browser renders it as a download link or, for `image/*` mime types, an inline preview.

## How parts compose

A single message can carry any combination of parts:

```ts
{
  text: 'Here is the result and the source data:',
  parts: [
    { type: 'text', text: 'Here is the result and the source data:' },
    { type: 'image', base64: '...', mediaType: 'image/png' },
    { type: 'file', url: 'https://.../report.pdf', name: 'report.pdf' },
  ],
}
```

The `text` field is the plain-text rollup of all `text`-typed parts, used for transcript persistence and for clients that don't render parts.

## Building parts

The SDK ships a helper:

```ts
import { buildParts } from '@cleanslice/bridle' // (planned export)

buildParts('Here is the image', [
  { base64: '...', mediaType: 'image/jpeg' },
])
// → [
//     { type: 'text',  text: 'Here is the image' },
//     { type: 'image', base64: '...', mediaType: 'image/jpeg' },
//   ]
```

The hub also accepts the legacy `{ text, images: [...] }` shape and converts it to parts internally — you don't need to upgrade existing call sites in lockstep.

## Wire flow

| Direction | Carries parts? |
|-----------|---------------|
| Browser → Hub (`message`) | yes |
| Hub → Agent (`message`) | yes |
| Agent → Hub (`message`, `stream`, `stream_end`) | yes |
| Hub → Browser (`message`, `stream`, `stream_end`) | yes |
| HTTP `POST /api/agent/:botId/message[/sync]` | yes (`body.parts`) |

If `parts` is omitted but `text` is present, the receiver synthesizes a single text part from the text. If both are omitted, the message is dropped.

## Client rendering

The embedded SDK renders text parts as plain paragraphs (with whitespace preserved). Images render inline; files render as download links. For richer rendering (Markdown, code blocks, tool-call traces), use the [headless client](/embed/headless) and render messages yourself.
