# Changelog

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
