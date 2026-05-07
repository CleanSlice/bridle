# Introduction

**Bridle** is a webchat relay for AI agents. It connects browser users to a long-running agent runtime through a stateless WebSocket hub, with a ready-made embeddable chat UI you can drop into any website.

```
Browser (any site)           Bridle Hub (NestJS)           Agent Runtime
     |                             |                             |
     |--- /ws/client --------------->|                             |
     |   auth: { token, agentId }    |--- /ws/agent -------------->|
     |                             |   auth: { apiKey, agentId }   |
     |<--- stream/message ---------|<--- stream/message ---------|
     |   { text, parts[] }         |   { text, parts[] }         |
```

## What's in the box

| Package | What it is | Stack |
|---------|------------|-------|
| `@cleanslice/bridle` | Embeddable Web Component for any site | Vue 3 (compiled), socket.io-client |
| `bridle/nestjs/` | Hub server — WebSocket relay + HTTP fallback | NestJS, Socket.IO, JWT |
| `bridle/runtime/` | Agent client library | socket.io-client |
| `bridle/nuxt/` | Nuxt layer — same UI as the SDK, but as a layer | Nuxt 3, Vue 3, shadcn-vue |

You typically need three things in production:

1. **The hub** (`bridle/nestjs/`) running somewhere — it accepts WebSocket connections from browsers and from agents.
2. **An agent runtime** (`bridle/runtime/`) — your agent process connects to the hub and handles incoming messages.
3. **The SDK on a website** — visitors load `bridle.js`, which connects to the hub, which routes their messages to your agent.

## Why a hub?

Browsers can't talk to agent runtimes directly:

- Agents typically live behind firewalls or in long-lived processes (workers, queues).
- Browsers need short-lived JWTs; agents need long-lived API keys.
- You want one agent process serving many browsers without the agent maintaining a TCP server.

The hub solves all three. It's a stateless router: agents register inbound, browsers register inbound, and messages get matched by `agentId`.

## Why streaming?

Modern LLMs emit tokens one at a time. Showing a finished message after a 30-second silence is a bad UX. The Bridle protocol carries `stream` events as they arrive, with the final `stream_end` committing the message. The SDK renders partial text live and replaces it with the final version.

## What this site is

This site (`bridle.cleanslice.org`) hosts:

- Documentation for embedding, deploying, and operating Bridle.
- The SDK CDN at [`/sdk/latest.js`](https://bridle.cleanslice.org/sdk/latest.js), [`/sdk/v1.js`](https://bridle.cleanslice.org/sdk/v1.js), and pinned versions.

You can pull the SDK from this site, from [unpkg](https://unpkg.com/@cleanslice/bridle), from [jsDelivr](https://cdn.jsdelivr.net/npm/@cleanslice/bridle), or self-host the bundle from your own hub. Pick whichever your CSP / latency / branding requirements prefer.
