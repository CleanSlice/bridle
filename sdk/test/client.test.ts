import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hub, flush, jwt, resetFakes, sockets, socketIoMock } from './fakeSocket'

vi.mock('socket.io-client', () => socketIoMock())

const { BridleClient, BridleAuthError } = await import('../src/client')

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0)
const valid = new Set<string>()

function startClient(opts: ConstructorParameters<typeof BridleClient>[0]) {
  const client = new BridleClient(opts)
  const log = { welcomes: [] as string[], errors: [] as string[] }
  client.on('welcome', ({ clientId }) => log.welcomes.push(clientId))
  client.on('error', (e) => log.errors.push(e instanceof BridleAuthError ? e.code : e.message))
  return { client, log }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  resetFakes()
  valid.clear()
  hub.check = (auth) => (valid.has(auth.token) ? null : auth.token === 'stale' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('BridleClient token handling', () => {
  it('asks for the current token on every (re)connect', async () => {
    let current = 'tok-1'
    valid.add('tok-1').add('tok-2')
    const { client } = startClient({ apiUrl: 'http://hub', agentId: 'a', getToken: async () => current })
    await client.connect()
    await flush()

    current = 'tok-2'
    sockets[0].drop()
    await flush()

    expect(sockets[0].handshakes.map((h) => h.token)).toEqual(['tok-1', 'tok-2'])
  })

  it('TOKEN_EXPIRED: forces the provider, reconnects and gets a welcome', async () => {
    const tokens = ['stale', 'fresh']
    valid.add('fresh')
    const provider = vi.fn(() => tokens.shift()!)
    const { client, log } = startClient({ apiUrl: 'http://hub', agentId: 'a', token: provider })
    await client.connect()
    await flush(30)

    expect(provider).toHaveBeenCalledTimes(2)
    expect(log.welcomes).toEqual(['visitor-of-fresh'])
    expect(log.errors).toEqual([])
  })

  it('a renewed token rejected again is reported once, no refresh loop', async () => {
    const provider = vi.fn(() => 'stale')
    const { client, log } = startClient({ apiUrl: 'http://hub', agentId: 'a', token: provider })
    await client.connect()
    await flush(30)

    expect(provider).toHaveBeenCalledTimes(2)
    expect(log.errors).toEqual(['TOKEN_EXPIRED'])
    expect(log.welcomes).toEqual([])
  })

  it('allows the next forced refresh only after 30 s', async () => {
    let n = 0
    const provider = vi.fn(() => (++n === 1 ? 'ok-1' : `stale`))
    valid.add('ok-1')
    const { client, log } = startClient({ apiUrl: 'http://hub', agentId: 'a', token: provider })
    await client.connect()
    await flush(30)
    expect(log.welcomes).toEqual(['visitor-of-ok-1'])

    // The token dies and the provider keeps handing out a dead one.
    valid.delete('ok-1')
    sockets[0].drop()
    await flush(30)
    expect(provider).toHaveBeenCalledTimes(2)
    // INVALID_TOKEN (the old token) was renewed silently; the renewed one is
    // rejected inside the 30 s window and reported.
    expect(log.errors).toEqual(['TOKEN_EXPIRED'])

    vi.setSystemTime(NOW + 31_000)
    sockets[0].connect()
    await flush(30)
    expect(provider).toHaveBeenCalledTimes(3)
  })

  it('INVALID_TOKEN is renewed the same way', async () => {
    const tokens = ['garbage', 'fresh']
    valid.add('fresh')
    const { client, log } = startClient({ apiUrl: 'http://hub', agentId: 'a', token: () => tokens.shift()! })
    await client.connect()
    await flush(30)
    expect(log.welcomes).toEqual(['visitor-of-fresh'])
    expect(log.errors).toEqual([])
  })

  it('a static token is reported, not renewed', async () => {
    const { client, log } = startClient({ apiUrl: 'http://hub', agentId: 'a', token: 'stale' })
    await client.connect()
    await flush(30)
    expect(client.canRefreshToken()).toBe(false)
    expect(log.errors).toEqual(['TOKEN_EXPIRED'])
  })

  it('bridle_warning renews and reconnects instead of continuing anonymously', async () => {
    const tokens = ['stale', 'fresh']
    hub.check = () => null
    hub.warn = (auth) => (auth.token === 'stale' ? 'TOKEN_EXPIRED' : null)
    const { client, log } = startClient({ apiUrl: 'http://hub', agentId: 'a', token: () => tokens.shift()! })
    await client.connect()
    await flush(30)
    expect(sockets[0].handshakes.map((h) => h.token)).toEqual(['stale', 'fresh'])
    expect(log.welcomes.at(-1)).toBe('visitor-of-fresh')
  })
})

describe('BridleClient.authorizedFetch', () => {
  const ok = (token: string) => valid.has(token)

  function stubFetch() {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const token = new Headers(init.headers).get('Authorization')?.replace('Bearer ', '') ?? ''
      calls.push(token)
      return new Response(null, { status: ok(token) ? 200 : 401 })
    }))
    return calls
  }

  it('401: renews the token and retries once', async () => {
    const calls = stubFetch()
    valid.add(jwt(Math.floor(NOW / 1000) + 900, 'fresh'))
    const fresh = [...valid][0]
    const provider = vi.fn(async () => fresh)
    const client = new BridleClient({ apiUrl: 'http://hub', agentId: 'a', getToken: async (o) => (o?.force ? provider() : 'expired') })

    const res = await client.authorizedFetch('http://hub/api/agent/a/transcript')
    expect(res.status).toBe(200)
    expect(calls).toEqual(['expired', fresh])
    expect(provider).toHaveBeenCalledTimes(1)
  })

  it('concurrent 401s share one renewal', async () => {
    stubFetch()
    valid.add('fresh')
    const provider = vi.fn(async () => 'fresh')
    const tokens = new (await import('../src/token')).TokenSource('expired', provider)
    const client = new BridleClient({ apiUrl: 'http://hub', agentId: 'a', getToken: (o) => tokens.get(o) })

    const results = await Promise.all([1, 2, 3].map((n) => client.authorizedFetch(`http://hub/${n}`)))
    expect(results.map((r) => r.status)).toEqual([200, 200, 200])
    expect(provider).toHaveBeenCalledTimes(1)
  })

  it('a static token gets the 401 back without a retry', async () => {
    const calls = stubFetch()
    const client = new BridleClient({ apiUrl: 'http://hub', agentId: 'a', token: 'expired' })
    const res = await client.authorizedFetch('http://hub/x')
    expect(res.status).toBe(401)
    expect(calls).toEqual(['expired'])
  })
})
