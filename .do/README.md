# DigitalOcean App Platform — Deploy Bridle Docs + SDK

This folder holds the App Platform spec for `bridle.cleanslice.org`.

## What gets deployed

- `bridle/docs/` — VitePress documentation site
- `bridle/sdk/` — built and copied into `docs/public/sdk/`

Result: a Static Site at `bridle.cleanslice.org` serving:
- `/` → docs home, all guide/embed/protocol/deploy pages
- `/sdk/latest.js` → the embeddable SDK
- `/sdk/v1.js`, `/sdk/v1.0.0.js`, `/sdk/*.mjs` → version aliases

Cost: free (App Platform includes 3 free static sites).

---

## First-time setup

### 1. Push this repo to GitHub

If `CleanSlice/bridle` doesn't exist yet:

```bash
cd bridle
git init
git remote add origin git@github.com:CleanSlice/bridle.git
git add .
git commit -m "Initial commit"
git push -u origin main
```

If `app.yaml` references a different repo, update `github.repo` in `.do/app.yaml`.

### 2. Create the app

Install [doctl](https://docs.digitalocean.com/reference/doctl/how-to/install/) and authenticate:

```bash
doctl auth init
```

Create the app from the spec:

```bash
doctl apps create --spec .do/app.yaml
```

This prints the app ID. App Platform pulls the GitHub repo and runs the build automatically.

### 3. Wire up the custom domain

App Platform assigns a default subdomain like `bridle-docs-abc12.ondigitalocean.app`. You'll see this in the dashboard or via:

```bash
doctl apps list
```

In your DNS provider (Cloudflare for `cleanslice.org`):

```
Type:   CNAME
Name:   bridle
Value:  <app-name>.ondigitalocean.app
TTL:    Auto
Proxy:  DNS only (don't proxy through Cloudflare — DO handles TLS)
```

Once DNS propagates (~5 min), DO issues a Let's Encrypt certificate automatically. Verify in the dashboard's "Domains" tab.

---

## Updating

Every push to `main` triggers a redeploy automatically (`deploy_on_push: true`).

To force a redeploy without code changes:

```bash
doctl apps create-deployment <APP_ID>
```

To update the spec (e.g., change build command, add env vars):

```bash
doctl apps update <APP_ID> --spec .do/app.yaml
```

---

## Cutting a new SDK release

The SDK version is in `bridle/sdk/package.json`. The `copy-sdk.mjs` script reads it and writes:

- `latest.js` — always the latest build
- `v1.js` — alias to the latest 1.x build
- `v1.2.3.js` — pinned exact version

To release `v1.3.0`:

1. Bump `bridle/sdk/package.json` version to `1.3.0`.
2. Commit + push to `main`. App Platform redeploys.
3. New URLs go live: `/sdk/v1.3.0.js` (immutable cache) and `/sdk/latest.js`, `/sdk/v1.js` (refreshed).

For a major bump (`v2.0.0`), `/sdk/v1.js` keeps serving the old major — embedders pinned to `v1` don't break.

---

## Local preview

Replicate the deployed build locally:

```bash
cd bridle/sdk && npm install && npm run build
cd ../docs && npm install && npm run build
cd docs && npx http-server .vitepress/dist -p 4173
```

Visit `http://localhost:4173` — full site preview, including `/sdk/latest.js`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `404` on `/sdk/latest.js` | Build didn't run. Check the App Platform deploy logs for `[copy-sdk] Copied SDK ... → docs/public/sdk/`. |
| Custom domain stuck on "Verifying" | DNS hasn't propagated. Wait 5–15 minutes. Confirm with `dig bridle.cleanslice.org`. |
| Build OOM | Edit `app.yaml` and increase `instance_size_slug`. The free tier should handle the build, but very long content can blow it. |
| SDK loads but `Bridle.init` is undefined | The IIFE didn't attach to `window`. Check `dist/bridle.js` is non-empty. |

---

## File reference

| File | Purpose |
|------|---------|
| `.do/app.yaml` | App Platform spec (build command, source dir, output dir) |
| `bridle/docs/scripts/copy-sdk.mjs` | Copies SDK build artifacts into `docs/public/sdk/` |
| `bridle/docs/docs/public/_headers` | Cache-Control rules per path (Netlify-style) |
| `bridle/sdk/package.json` | SDK version (single source of truth for filenames) |
