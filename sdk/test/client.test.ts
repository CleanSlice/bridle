import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hub, flush, jwt, resetFakes, sockets, socketIoMock, TIMERS_WITH_PERFORMANCE } from './fakeSocket'

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

/*
 * The hub answers a `message` that carries a `clientMessageId` through the
 * socket.io acknowledgement. A full request limit comes back that way too, and
 * it is a state to wait out, not a failure: it must never reach `error`, which
 * is what paints the red banner.
 */
describe('BridleClient send acknowledgement and limits', () => {
  type LimitState = { limited: boolean; retryAfterMs?: number; window?: string }

  async function connected() {
    // The outer hook already installed fake timers, and a second install is a
    // no-op until the first is undone.
    vi.useRealTimers()
    vi.useFakeTimers(TIMERS_WITH_PERFORMANCE)
    vi.setSystemTime(NOW)
    hub.check = () => null
    const { client, log } = startClient({ apiUrl: 'http://hub', agentId: 'a' })
    const limits: LimitState[] = []
    const messages: string[] = []
    client.on('limit', (state) => limits.push(state))
    client.on('message', (m) => messages.push(m.text))
    await client.connect()
    await flush()
    return { client, log, limits, messages, socket: sockets[0] }
  }

  const rateLimited = (retryAfterMs: number, window = 'minute') => () => ({
    status: 'rejected',
    code: 'RATE_LIMITED',
    retryAfterMs,
    window,
  })

  it('sends a clientMessageId and passes an acknowledgement callback', async () => {
    const { client, socket } = await connected()
    void client.send('hello')

    expect(socket.sent).toEqual([
      { text: 'hello', parts: [{ type: 'text', text: 'hello' }], clientMessageId: expect.any(String) },
    ])
    expect((socket.sent[0] as { clientMessageId: string }).clientMessageId.length).toBeGreaterThan(0)
    expect(typeof socket.acks[0]).toBe('function')
  })

  it('uses the id the caller minted and resolves with the accepted outcome', async () => {
    hub.ack = (payload) => ({ status: 'accepted', messageId: payload.clientMessageId, ts: 7 })
    const { client, socket } = await connected()

    const outcome = await client.send('hello', undefined, { clientMessageId: 'bubble-1' })
    expect((socket.sent[0] as { clientMessageId: string }).clientMessageId).toBe('bubble-1')
    expect(outcome).toEqual({ status: 'accepted', messageId: 'bubble-1', ts: 7 })
  })

  it('RATE_LIMITED fires limit, never error', async () => {
    hub.ack = rateLimited(42_000)
    const { client, log, limits } = await connected()

    const outcome = await client.send('hello')
    expect(outcome).toEqual({ status: 'rejected', code: 'RATE_LIMITED', retryAfterMs: 42_000, window: 'minute' })
    expect(limits).toEqual([{ limited: true, retryAfterMs: 42_000, window: 'minute' }])
    expect(log.errors).toEqual([])
  })

  it('while limited nothing is sent and limit fires again with the remaining wait', async () => {
    hub.ack = rateLimited(42_000)
    const { client, socket, limits } = await connected()
    await client.send('first')

    await vi.advanceTimersByTimeAsync(12_000)
    const outcome = await client.send('second')

    expect(socket.sent).toHaveLength(1)
    expect(outcome).toEqual({ status: 'rejected', code: 'RATE_LIMITED', retryAfterMs: 30_000, window: 'minute' })
    expect(limits.at(-1)).toEqual({ limited: true, retryAfterMs: 30_000, window: 'minute' })
    expect(client.getLimit()).toEqual({ limited: true, retryAfterMs: 30_000, window: 'minute' })
  })

  it('reports the end of the wait once and sends again after it', async () => {
    hub.ack = rateLimited(42_000)
    const { client, socket, limits } = await connected()
    await client.send('first')

    await vi.advanceTimersByTimeAsync(42_000)
    expect(limits.at(-1)).toEqual({ limited: false })
    expect(limits.filter((l) => !l.limited)).toHaveLength(1)
    expect(client.getLimit()).toEqual({ limited: false })

    hub.ack = undefined
    void client.send('second')
    expect(socket.sent).toHaveLength(2)
  })

  it('listens to agent_limit: a full window blocks sending, an early release opens it', async () => {
    const { client, socket, limits, log } = await connected()

    socket.trigger('agent_limit', { type: 'agent_limit', agentId: 'a', limited: true, retryAfterMs: 600_000, window: 'hour' })
    expect(limits).toEqual([{ limited: true, retryAfterMs: 600_000, window: 'hour' }])
    await client.send('blocked')
    expect(socket.sent).toEqual([])

    socket.trigger('agent_limit', { type: 'agent_limit', agentId: 'a', limited: false })
    expect(limits.at(-1)).toEqual({ limited: false })
    void client.send('goes out')
    expect(socket.sent).toHaveLength(1)
    expect(log.errors).toEqual([])
  })

  it('ignores an agent_limit addressed to another agent', async () => {
    const { socket, limits } = await connected()
    socket.trigger('agent_limit', { type: 'agent_limit', agentId: 'other', limited: true, retryAfterMs: 600_000, window: 'hour' })
    expect(limits).toEqual([])
  })

  it('AGENT_OFFLINE becomes the line the hub no longer sends to an acknowledging client', async () => {
    hub.ack = () => ({ status: 'rejected', code: 'AGENT_OFFLINE' })
    const { client, messages, log, limits } = await connected()

    const outcome = await client.send('hello')
    expect(outcome).toEqual({ status: 'rejected', code: 'AGENT_OFFLINE' })
    expect(messages).toEqual(['Agent is not connected. Please try again later.'])
    expect(log.errors).toEqual([])
    expect(limits).toEqual([])
  })

  it('a hub that never acknowledges settles as unacknowledged, with nothing fired', async () => {
    const { client, limits, messages, log } = await connected()
    const pending = client.send('hello')
    await vi.advanceTimersByTimeAsync(10_000)

    expect(await pending).toEqual({ status: 'unacknowledged', messageId: expect.any(String) })
    expect(limits).toEqual([])
    expect(messages).toEqual([])
    expect(log.errors).toEqual([])
  })
})

/*
 * What the client says it can render. The hub forwards the list to the agent
 * on every message, so narrowing it is what actually stops picture replies -
 * hiding the widget's picker only closes the visitor's side of the door.
 */
describe('BridleClient capabilities', () => {
  it('advertises everything the widget renders by default', async () => {
    valid.add('t')
    const { client } = startClient({ apiUrl: 'http://hub', agentId: 'a', getToken: async () => 't' })
    await client.connect()
    await flush()

    expect(sockets[0].handshakes[0].capabilities).toEqual(['streaming', 'images', 'files', 'ui'])
  })

  it('sends the narrowed list when the integrator drops one', async () => {
    valid.add('t')
    const { client } = startClient({
      apiUrl: 'http://hub',
      agentId: 'a',
      getToken: async () => 't',
      capabilities: ['streaming', 'files', 'ui'],
    })
    await client.connect()
    await flush()

    expect(sockets[0].handshakes[0].capabilities).toEqual(['streaming', 'files', 'ui'])
  })

  it('repeats the narrowed list on every reconnect', async () => {
    valid.add('t')
    const { client } = startClient({
      apiUrl: 'http://hub',
      agentId: 'a',
      getToken: async () => 't',
      capabilities: ['streaming', 'files', 'ui'],
    })
    await client.connect()
    await flush()
    sockets[0].drop()
    await flush()

    expect(sockets[0].handshakes.map((h) => h.capabilities)).toEqual([
      ['streaming', 'files', 'ui'],
      ['streaming', 'files', 'ui'],
    ])
  })
})
