# Bridle embed example

The smallest realistic embed setup. A tiny Node server mints embed JWTs against a Ranch hub and serves the **locally built** SDK so you can iterate on `sdk/` and refresh the page to see changes immediately.

```
Browser  ─►  example server (8787)  ─►  Ranch hub (3333)
              │ GET /embed/token             │ POST /auth/embed/token
              │   (server-side, with         │   (validates RANCH_API_KEY,
              │    RANCH_API_KEY)            │    mints bridle JWT)
              ▼                              ▼
        index.html drops <script src="/sdk/latest.js" data-token="...">
              ▼
        bridle/sdk → <bridle-chat> custom element
              ▼
        WebSocket /ws/client → Ranch → registered agent runtime
```

## What you need first

This example talks to a **Ranch** deployment — Ranch is the Bridle hub in this stack. You'll need:

1. **A running Ranch instance** with the API reachable on some origin (default: `http://localhost:3333`). See `ranch/` in the cleanslice monorepo, or `ranch/README.md`.
2. **An agent created in Ranch.** Go to the Ranch admin UI, create an agent, and grab its id (e.g. `agent-31a6fbd1-…`). This is what the browser will chat with.
3. **An agent runtime connected to that agent.** A Bridle agent is just the runtime (`ranch-api`'s paddock or your own bot) connected to Ranch's `/ws/agent` namespace with `BRIDLE_AGENT_ID=<the-id>` and the runtime's `BRIDLE_API_KEY`. Without a runtime online the chat connects fine but nothing answers your messages.
4. **A Ranch API key** with permission to mint embed JWTs. Create one in the Ranch admin UI (Settings → API Keys). The example server uses it server-side to call `POST /auth/embed/token`.

## Setup

```bash
cd bridle/sdk && npm install && npm run build   # builds dist/ that the example serves
cd ../example
cp .env.example .env
# edit .env — RANCH_API_KEY and BRIDLE_AGENT_ID are required
npm run dev
```

Open <http://localhost:8787>. You should see a chat panel. Type something — the agent runtime on the Ranch side replies.

If you change SDK source, run `npm run build` inside `sdk/` again (or `npm run dev` for watch mode) and refresh the browser. The example server reads from `../sdk/dist` on every request.

## Configuration

All values live in `.env`. See [.env.example](./.env.example) for the full list. The important ones:

| Variable | Required | Description |
|----------|----------|-------------|
| `RANCH_API_URL` | no | Ranch hub origin. Default: `http://localhost:3333`. |
| `RANCH_API_KEY` | **yes** | Server-side key used to mint embed JWTs. Never sent to the browser. |
| `BRIDLE_AGENT_ID` | **yes** | The agent id the embed connects to. |
| `RANCH_EMBED_TOKEN_TTL` | no | JWT lifetime, e.g. `7d`, `15m`. Default: `7d`. |
| `PORT` | no | Port the example server listens on. Default: `8787`. |

## How the auth flow works

1. **Browser** loads `index.html`, which fetches `GET /embed/token?sub=user-123&email=alice@example.com` on the same origin.
2. **Example server** sees the request, calls `POST $RANCH_API_URL/auth/embed/token` with `Authorization: Bearer $RANCH_API_KEY` and the requested `sub`/`email`.
3. **Ranch** validates the API key, mints a short-lived JWT signed with its own secret, and returns `{ token, expiresAt }`.
4. **Example server** wraps the response with the public-safe fields the page needs (`apiUrl`, `agentId`) and returns it to the browser.
5. **Browser** appends `<script src="/sdk/latest.js" data-token="<jwt>" data-agent-id="…" data-api-url="…">` — the SDK auto-mounts and opens a WebSocket to `RANCH_API_URL/ws/client` with the JWT.

The Ranch API key never reaches the browser. Only the minted JWT does.

## Customizing the embed

The example demos the [`data-custom-css`](https://bridle.cleanslice.org/embed/theming#overriding-internal-classes) option (SDK v0.8.0) by tweaking the panel's border and shadow. Edit or remove that block in [index.html](./index.html) to see the stock look. All the SDK `data-*` attributes work here — `data-mode`, `data-title`, `data-stylesheet`, `data-placeholder`, etc.

## Troubleshooting

| Symptom | Cause |
|---------|-------|
| `Failed to start bridle: fetch failed` in the page | Ranch isn't running on `RANCH_API_URL`. Start the Ranch API. |
| `RANCH_API_KEY is not set on the server` (500) | `.env` missing or `RANCH_API_KEY=…` not filled in. |
| `BRIDLE_AGENT_ID is not set on the server` (500) | `BRIDLE_AGENT_ID=…` missing in `.env`. |
| `Origin … isn't whitelisted for this agent` banner | Add `http://localhost:8787` to the agent's allowed origins in Ranch admin. |
| Chat connects, you send a message, nothing happens | No agent runtime is connected for this `BRIDLE_AGENT_ID`. Start the runtime / paddock. |
| `/sdk/latest.js` 404 | SDK isn't built yet. Run `npm run build` inside `../sdk`. |
