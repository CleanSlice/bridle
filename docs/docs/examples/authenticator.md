# 04 · Authenticator

Pass `token` as a **function** instead of a string. The SDK awaits it before opening the WebSocket — and can call it again to refresh an expired JWT. Your hub API key never reaches the browser: the function fetches a freshly-minted JWT from your own backend, which mints it server-side.

## Snippet

```js
Bridle.init({
  apiUrl,
  agentId,
  mode: 'inline',
  mount: '#chat-authn',
  title: 'Token via function',
  token: async () => {
    const r = await fetch('/embed/token?sub=user-42')
    if (!r.ok) throw new Error(`token ${r.status}`)
    const { token } = await r.json()
    return token
  },
  onReady: () => console.log('[bridle] ready'),
  onError: (e) => console.error('[bridle] error', e),
})
```

## Live demo

<BridleEmbed title="Auth via token()" />

> The hosted demo agent is public (origin-whitelisted on the hub), so no JWT is required here. In your own integration the `token()` function would mint a fresh JWT server-side on every connect.

## Token forms

| `token` value | When used |
|---------------|-----------|
| `string` | You already have the JWT (e.g. SSR'd into the page) |
| `() => string` | Sync producer — read from cookie / store |
| `() => Promise<string>` | Async producer — fetch from your token endpoint |
| omitted | Public agent — hub accepts based on the request `Origin` |

## Server side — keep the key on the server

The browser must never see your hub's API key. Your backend exposes a thin endpoint that mints a short-lived JWT and returns it:

```js
// /embed/token — your backend
app.get('/embed/token', async (req, res) => {
  const r = await fetch(`${process.env.RANCH_API_URL}/auth/embed/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RANCH_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sub: req.user.id,
      email: req.user.email,
      expiresIn: '15m',
    }),
  })
  const { data } = await r.json()
  res.json({ token: data.token })
})
```

The browser never sees `RANCH_API_KEY` — only the minted JWT.

## Refresh

If your function throws because the JWT expired, surface the error via `onError` and re-init, or have the function itself detect a stale cached token and re-fetch before returning. The SDK does not run a refresh timer on its own.

## Callbacks

| Callback | Fires when |
|----------|------------|
| `onReady` | The widget has mounted and the WebSocket is open |
| `onMessage` | Any message (user or assistant) is added to the transcript |
| `onError` | Auth failed, token producer threw, or the connection dropped |

## Next

- [Protocol → Authentication](/protocol/authentication) — JWT claims, admin role, expiry rules.
- [Deploy → Hub](/deploy/hub) — how the hub verifies the JWT.
