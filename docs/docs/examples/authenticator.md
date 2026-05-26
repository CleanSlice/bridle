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

The browser must never see your hub's API key. Your backend exposes a thin endpoint that mints a short-lived JWT and returns it. Pick your stack:

::: code-group

```js [Node.js (Express)]
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

```python [Python (Flask)]
# /embed/token — your backend
import os, requests
from flask import g, jsonify

@app.get('/embed/token')
def embed_token():
    r = requests.post(
        f"{os.environ['RANCH_API_URL']}/auth/embed/token",
        headers={
            'Authorization': f"Bearer {os.environ['RANCH_API_KEY']}",
            'Content-Type': 'application/json',
        },
        json={
            'sub':       g.user.id,
            'email':     g.user.email,
            'expiresIn': '15m',
        },
        timeout=5,
    )
    r.raise_for_status()
    data = r.json()['data']
    return jsonify(token=data['token'])
```

```php [PHP (Laravel)]
// routes/web.php — your backend
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;

Route::get('/embed/token', function (Request $request) {
    $res = Http::withHeaders([
        'Authorization' => 'Bearer ' . env('RANCH_API_KEY'),
        'Content-Type'  => 'application/json',
    ])->post(env('RANCH_API_URL') . '/auth/embed/token', [
        'sub'       => $request->user()->id,
        'email'     => $request->user()->email,
        'expiresIn' => '15m',
    ])->throw();

    return response()->json([
        'token' => $res->json('data.token'),
    ]);
});
```

```java [Java (Spring Boot)]
// EmbedTokenController.java — your backend
@RestController
public class EmbedTokenController {

  private final WebClient ranch = WebClient.create(System.getenv("RANCH_API_URL"));

  @GetMapping("/embed/token")
  public Map<String, String> mint(@AuthenticationPrincipal User user) {
    var body = Map.of(
        "sub",       user.getId(),
        "email",     user.getEmail(),
        "expiresIn", "15m"
    );

    JsonNode res = ranch.post()
        .uri("/auth/embed/token")
        .header("Authorization", "Bearer " + System.getenv("RANCH_API_KEY"))
        .header("Content-Type", "application/json")
        .bodyValue(body)
        .retrieve()
        .bodyToMono(JsonNode.class)
        .block();

    return Map.of("token", res.get("data").get("token").asText());
  }
}
```

```csharp [C# (ASP.NET Core)]
// Program.cs — your backend
app.MapGet("/embed/token", async (HttpContext ctx, IHttpClientFactory http) =>
{
    var user = ctx.User;
    var client = http.CreateClient();
    client.DefaultRequestHeaders.Authorization =
        new("Bearer", Environment.GetEnvironmentVariable("RANCH_API_KEY"));

    var res = await client.PostAsJsonAsync(
        $"{Environment.GetEnvironmentVariable("RANCH_API_URL")}/auth/embed/token",
        new {
            sub       = user.FindFirst("sub")!.Value,
            email     = user.FindFirst("email")!.Value,
            expiresIn = "15m",
        });
    res.EnsureSuccessStatusCode();

    var payload = await res.Content.ReadFromJsonAsync<JsonElement>();
    return Results.Ok(new {
        token = payload.GetProperty("data").GetProperty("token").GetString(),
    });
})
.RequireAuthorization();
```

:::

The browser never sees `RANCH_API_KEY` — only the minted JWT. Ranch wraps every response as `{ success, data }`, so unwrap `data.token` from the JSON before returning it to the client.

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
