# SDK Hosting

Where to host the SDK bundle (`bridle.js`) so embedders can `<script src="...">` it. Pick the path that fits your operational profile.

## Option 1 — bridle.cleanslice.org (this site)

The simplest path. The SDK is built and served alongside this docs site:

```html
<script src="https://bridle.cleanslice.org/sdk/latest.js" ...></script>
```

URLs available:

| URL | Behavior |
|-----|----------|
| `/sdk/latest.js` | Latest build, no caching guarantees |
| `/sdk/v1.js` | Latest **1.x** build |
| `/sdk/v1.0.0.js` | Pinned exact version |
| `/sdk/latest.mjs`, `/sdk/v1.mjs`, `/sdk/v1.0.0.mjs` | ESM equivalents |

CORS is open (`Access-Control-Allow-Origin: *`) — the bundle is just JavaScript, safe to serve cross-origin.

This is the path embedders use by default. **No setup on your side.**

## Option 2 — npm + jsDelivr / unpkg

`@cleanslice/bridle` is published to npm. Public CDNs mirror npm automatically:

```html
<!-- jsDelivr -->
<script src="https://cdn.jsdelivr.net/npm/@cleanslice/bridle@1/dist/bridle.js"></script>

<!-- unpkg -->
<script src="https://unpkg.com/@cleanslice/bridle@1/dist/bridle.js"></script>
```

Use the `@1` tag to pin to the major version. Use `@latest` for the bleeding edge. Use `@1.0.0` for an exact pin.

Trade-offs:
- ✅ Free, global edge cache.
- ✅ Standard for open-source.
- ❌ Cross-origin from your site → some CSPs reject.
- ❌ Out of your control if jsDelivr has an outage.

## Option 3 — host the SDK from your hub

For maximum control and the simplest CSP, serve the SDK from your hub's origin. The Bridle hub repo includes a static-serve handler — copy the SDK build output into the hub's public directory:

```bash
# In your CI
cd bridle/sdk && npm ci && npm run build
cp -r bridle/sdk/dist your-hub/public/sdk
```

In NestJS, enable static serving:

```ts
import { ServeStaticModule } from '@nestjs/serve-static'
import { join } from 'path'

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/sdk',
      serveStaticOptions: {
        immutable: true,
        maxAge: '1y',
        setHeaders: (res, path) => {
          if (path.endsWith('.js') || path.endsWith('.mjs')) {
            res.setHeader('Access-Control-Allow-Origin', '*')
          }
        },
      },
    }),
  ],
})
```

Then embedders use:

```html
<script src="https://your-hub.example.com/sdk/latest.js" ...></script>
```

Since the hub and SDK share an origin, `data-api-url` can be omitted — the SDK infers it from `document.currentScript.src`.

Trade-offs:
- ✅ One domain in your CSP.
- ✅ SDK version always matches hub version — no drift.
- ✅ Easier embed snippet (no `data-api-url`).
- ❌ Hub serves static assets — small extra load.
- ❌ Each hub deployment ships its own SDK bundle.

## Option 4 — your own CDN (Cloudflare R2, AWS S3 + CloudFront)

For brand consistency and full control:

```html
<script src="https://cdn.your-brand.com/bridle/v1.js" ...></script>
```

Build the SDK in CI, upload `dist/bridle.js` and `dist/bridle.mjs` to your bucket with appropriate cache headers, and configure your CDN to fan out from there.

Trade-offs:
- ✅ Your domain, your branding, your monitoring.
- ✅ Atomic releases — point `latest` to a new version with a single config change.
- ❌ Most operational overhead — bucket lifecycle, invalidation, version pinning.

## Recommendation matrix

| Use case | Pick |
|----------|------|
| Just want to embed and forget | bridle.cleanslice.org |
| Self-hosted hub, single domain | Host from your hub |
| Multiple hubs, shared SDK | bridle.cleanslice.org or your own CDN |
| Strict CSP, no third-party | Host from your hub or your own CDN |
| Open-source library / docs | npm + jsDelivr |

## What gets served

The build pipeline produces:

```
dist/
├── bridle.js         # IIFE bundle for <script src> (~80 KB gzipped)
├── bridle.js.map
├── bridle.mjs        # ESM bundle for bundlers
├── bridle.mjs.map
├── index.d.ts        # TypeScript declarations
├── client.d.ts
└── types.d.ts
```

For `<script>` use, only `bridle.js` matters. The other files are for npm consumers.
