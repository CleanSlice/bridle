import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env without pulling in dotenv. Lines are KEY=VALUE; lines starting
// with `#` and blank lines are ignored. process.env already wins so the
// shell can override what's in the file.
try {
  const raw = await readFile(join(__dirname, '.env'), 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!(key in process.env)) process.env[key] = value
  }
} catch (err) {
  if (err.code !== 'ENOENT') console.warn('[env] failed to load .env:', err.message)
}

const PORT = process.env.PORT || 8787
// SDK is built one level up at ../sdk/dist. Run `npm run build` inside sdk/
// before starting this server, otherwise /sdk/latest.js will 404.
const SDK_DIST = join(__dirname, '..', 'sdk', 'dist')
const RANCH_API_URL = process.env.RANCH_API_URL || 'http://localhost:3333'
const RANCH_API_KEY = process.env.RANCH_API_KEY || ''
const BRIDLE_AGENT_ID = process.env.BRIDLE_AGENT_ID || ''
// Bridle's default is 15m which is painful for dev — a refresh after lunch
// shows "token expired". Allow the operator to override via env, and as
// a last resort via `?expiresIn=...` on the request. Format: `<n>(s|m|h|d)`.
const RANCH_EMBED_TOKEN_TTL = process.env.RANCH_EMBED_TOKEN_TTL || '7d'

if (!RANCH_API_KEY) {
  console.warn('[env] RANCH_API_KEY is unset — /embed/token will 500 until it is provided')
}
if (!BRIDLE_AGENT_ID) {
  console.warn('[env] BRIDLE_AGENT_ID is unset — /embed/token will 500 until it is provided')
}

const send = (res, status, body, contentType) => {
  res.writeHead(status, { 'Content-Type': contentType })
  res.end(body)
}

const sendJson = (res, status, payload) =>
  send(res, status, JSON.stringify(payload), 'application/json; charset=utf-8')

// Calls Ranch's POST /auth/embed/token with the server-side API key and
// returns the minted JWT back to the browser. The API key never leaves
// this process — that's the whole point of having a token endpoint here
// instead of dropping the raw key into the page.
const mintEmbedToken = async ({ sub, email, roles, expiresIn }) => {
  const res = await fetch(`${RANCH_API_URL}/auth/embed/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RANCH_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sub, email, roles, expiresIn }),
  })
  const text = await res.text()
  let parsed
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = null }
  if (!res.ok) {
    const message = parsed?.message || text || `Ranch API ${res.status}`
    const err = new Error(message)
    err.status = res.status
    throw err
  }
  // Ranch wraps responses as `{ success, data }`. Unwrap if present.
  return parsed?.data ?? parsed
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = await readFile(join(__dirname, 'index.html'), 'utf8')
      return send(res, 200, html, 'text/html; charset=utf-8')
    }

    // Mint a browser embed JWT and return the hub/agent config alongside it.
    // The page does a single fetch on load and gets everything it needs to
    // mount the SDK — keeps `index.html` static (no env templating).
    if (req.method === 'GET' && req.url?.startsWith('/embed/token')) {
      console.log('RANCH_API_KEY', RANCH_API_KEY)
      if (!RANCH_API_KEY) {
        return sendJson(res, 500, { error: 'RANCH_API_KEY is not set on the server' })
      }
      if (!BRIDLE_AGENT_ID) {
        return sendJson(res, 500, { error: 'BRIDLE_AGENT_ID is not set on the server' })
      }
      const url = new URL(req.url, `http://localhost:${PORT}`)
      const sub = url.searchParams.get('sub') ?? 'user-123'
      const email = url.searchParams.get('email') ?? 'alice@example.com'
      const expiresIn =
        url.searchParams.get('expiresIn') || RANCH_EMBED_TOKEN_TTL
      try {
        const data = await mintEmbedToken({ sub, email, expiresIn })
        return sendJson(res, 200, {
          ...data,
          apiUrl: RANCH_API_URL,
          agentId: BRIDLE_AGENT_ID,
        })
      } catch (err) {
        console.error('[embed] mint failed:', err.message)
        return sendJson(res, err.status || 500, { error: err.message })
      }
    }

    // Serve the freshly-built SDK so the example exercises local bridle code
    // instead of the deployed bridle.cleanslice.org/sdk/latest.js.
    if (req.method === 'GET' && req.url?.startsWith('/sdk/')) {
      const file = req.url.replace('/sdk/', '').replace(/\?.*$/, '')
      const map = {
        'latest.js': 'bridle.js',
        'latest.mjs': 'bridle.mjs',
        'latest.js.map': 'bridle.js.map',
        'latest.mjs.map': 'bridle.mjs.map',
      }
      const target = map[file] ?? file
      const buf = await readFile(join(SDK_DIST, target))
      const ct = target.endsWith('.map')
        ? 'application/json'
        : 'application/javascript; charset=utf-8'
      return send(res, 200, buf, ct)
    }

    send(res, 404, 'Not found', 'text/plain')
  } catch (err) {
    if (err.code === 'ENOENT') {
      send(res, 404, 'Not found', 'text/plain')
    } else {
      console.error(err)
      send(res, 500, String(err), 'text/plain')
    }
  }
})

server.listen(PORT, () => {
  console.log(`> http://localhost:${PORT}`)
  console.log(`> Serving local SDK from ${SDK_DIST}`)
  console.log(`> Ranch hub:  ${RANCH_API_URL}`)
  console.log(`> Bridle agent: ${BRIDLE_AGENT_ID || '(unset — set BRIDLE_AGENT_ID in .env)'}`)
})
