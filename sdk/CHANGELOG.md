# Changelog

## 0.16.0

A calm notice when the agent's request limit is full (CLEAN-224).

A hub can now cap how many requests an agent takes per minute, hour and day.
Before: the widget sent a message and never looked at the answer, so against a
refusing hub it showed a sent-looking bubble, emptied the message field and
left the typing dots running for good.

### Integrator-facing

- **The notice.** Above the message field: "This agent has reached its message
  limit." / "Try again in 0:42." — a countdown under an hour, the time of day
  from an hour up ("Try again after 14:30.", "tomorrow after" past midnight).
  Neutral colours, not the red banner; not dismissible; announced once to a
  screen reader. When the wait ends it says "You can send your message now."
  for a moment and leaves. Nothing is sent automatically.
- **Nothing is lost on a refusal.** The refused message leaves the
  conversation, no typing dots stay, and its text and attachments are back in
  the message field, which stays editable throughout. A refused form is not
  marked as sent.
- **Nothing leaves during the wait** — Send (`aria-disabled`, described by the
  notice), Enter, suggestion chips, form submit, and messages queued while the
  socket was down. "New chat" does not clear the wait.
- **Texts.** `limitLabel` (default "This agent has reached its message
  limit.") and `limitRetryLabel` (default "Try again in {time}."), also as
  `data-limit-label` / `data-limit-retry-label`.
- **`onLimit` / the `limit` event** with
  `{ limited: boolean, retryAfterMs?: number, window?: 'minute'|'hour'|'day' }`:
  on a refused send, when the hub announces a full hour or day limit, when
  `sendMessage()` is tried during the wait (nothing is sent), and with
  `limited: false` when the wait ends. `onError` is not called for a limit.
- **Theme variables** `--bridle-info-bg`, `--bridle-info-bg-strong`,
  `--bridle-info-fg`, `--bridle-info-border`, `--bridle-info-accent`; they
  default to the theme's own surface colours, light and dark.
- **Headless `BridleClient`**: `send(text, parts?, { clientMessageId? })` now
  returns a promise of the hub's answer — `accepted`, `rejected` with a `code`,
  or `unacknowledged` after 10 s against a hub that does not acknowledge. It
  never rejects, so callers that ignore it are unaffected. New `limit` event
  and `getLimit()`. While limited, `send()` sends nothing and fires `limit`
  again with the remaining wait. A limit never reaches `error`.

### On the wire

- Every `message` carries a `clientMessageId` and a socket.io acknowledgement
  callback. Hubs that ignore both (the reference hub, older Ranch builds)
  behave exactly as before.
- A hub that acknowledges stops sending such a client its synthetic "Agent is
  not connected. Please try again later." message, so the client renders that
  line itself from `AGENT_OFFLINE` in the acknowledgement. Nothing changes for
  the visitor.
- New hub → browser event `agent_limit`. See `docs/PROTOCOL.md` § Request
  limits.

### Also

- The Send button has an accessible name ("Send"); it had none.
- Nuxt layer: the same behaviour in `stores/bridle.ts`, `BridleProvider` and
  `BridleInput` — acknowledgement, rollback of the refused bubble, the wait
  above the input, Send off while the field stays editable. `sendMessage()`
  returns `false` when nothing was sent.

## 0.15.1

Documents and a switch for pictures in the attachment picker.

- **`accept` / `uploadUrl`** (`data-accept`, `data-upload-url`). The picker can
  offer more than images. A file that is not an image is posted to `uploadUrl`
  as `multipart/form-data` and travels as a `file` part with the URL it
  answers; without `uploadUrl` the widget says the chat accepts images only
  instead of dropping the file quietly.
- **`enableImages`** (`data-enable-images`), default `true`. `false` hides the
  picker, refuses pasted and dropped images, and drops `images` from the
  capabilities sent at handshake, so the agent stops sending picture replies
  as well. The picker stays for documents when `uploadUrl` is set.
- Release: the package is published to npm through Trusted Publishing when a
  version bump in `sdk/package.json` reaches `main` (CLEAN-221); this version
  was the first one released that way.

## 0.15.0

Embed tokens are renewed instead of leaving the chat rejected (CLEAN-188).

Before: `init({ token: fn })` called the function once and kept the string, and
every socket.io reconnect re-sent it. After the token's TTL the first reconnect
(network drop, sleep, hub restart) ended in a red `TOKEN_EXPIRED` banner, and
transcript / archive requests failed with a silent `401`.

### Integrator-facing

- **Token provider.** `token: () => string | Promise<string>` is now kept as a
  provider and called for the first token, ~60 s before each token's `exp`, and
  after the hub rejects a token. Recommended integration:
  `token: () => fetch('/my-backend/bridle-token').then((r) => r.json()).then((j) => j.token)`,
  your backend minting via `POST /auth/embed/token` with an `embed:mint` key.
  Do not pass a long `expiresIn` to work around expiry.
- **Reconnects carry the current token.** The handshake asks for the token on
  every (re)connect. On `bridle_error` `TOKEN_EXPIRED` / `INVALID_TOKEN` the
  widget renews once and reconnects (at most one forced renewal per 30 s); the
  conversation stays on screen and messages typed meanwhile are sent after
  `welcome`.
- **HTTP calls** (transcript, archive) use the same token and renew + retry once
  on `401`.
- **Static tokens.** New `instance.setToken(token)` (or a new `token` attribute)
  reconnects with the new token and keeps the conversation. New
  `onTokenExpired` option / `token-expired` event fires when a static token is
  rejected and the widget cannot renew it.
- **No raw codes.** An unrecoverable expiry shows "Your session has expired"
  with **Reconnect** (re-runs the provider, or fires `token-expired` again) and,
  for static tokens, **Reload the page**. Texts: `sessionExpiredLabel`,
  `reconnectLabel`, `reloadLabel` (`data-session-expired-label`,
  `data-reconnect-label`, `data-reload-label`).
- **Headless `BridleClient`**: new `getToken` / `canRefreshToken` options and
  `authorizedFetch()`. A non-fatal `bridle_warning` `TOKEN_EXPIRED` (for hubs
  that degrade public agents to anonymous) renews and reconnects so the visitor
  keeps their identity.
