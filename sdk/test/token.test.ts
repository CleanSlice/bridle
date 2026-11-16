import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TokenSource, jwtExpiresAt } from '../src/token'
import { jwt } from './fakeSocket'

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0)
const inSeconds = (s: number) => Math.floor((NOW + s * 1000) / 1000)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('jwtExpiresAt', () => {
  it('reads exp from the payload without verifying', () => {
    expect(jwtExpiresAt(jwt(inSeconds(900)))).toBe(inSeconds(900) * 1000)
  })

  it('is null for anything that is not a JWT with a numeric exp', () => {
    expect(jwtExpiresAt('')).toBeNull()
    expect(jwtExpiresAt('opaque-token')).toBeNull()
    expect(jwtExpiresAt('a.%%%.c')).toBeNull()
  })
})

describe('TokenSource', () => {
  it('caches the provider token between calls', async () => {
    const provider = vi.fn(() => jwt(inSeconds(900)))
    const tokens = new TokenSource(undefined, provider)

    const first = await tokens.get()
    expect(await tokens.get()).toBe(first)
    expect(provider).toHaveBeenCalledTimes(1)
    tokens.dispose()
  })

  it('renews proactively ~60 s before exp', async () => {
    let n = 0
    const provider = vi.fn(() => jwt(inSeconds(900 * ++n)))
    const tokens = new TokenSource(undefined, provider)
    await tokens.get()

    await vi.advanceTimersByTimeAsync(839_000)
    expect(provider).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(provider).toHaveBeenCalledTimes(2)
    expect(jwtExpiresAt(await tokens.get())).toBe(inSeconds(1800) * 1000)
    tokens.dispose()
  })

  it('asks again inside the last minute even without the timer', async () => {
    const provider = vi.fn(() => jwt(inSeconds(30)))
    const tokens = new TokenSource(jwt(inSeconds(30)), provider)
    tokens.dispose()

    await tokens.get()
    expect(provider).toHaveBeenCalledTimes(1)
  })

  it('force bypasses the cache and concurrent callers share one call', async () => {
    const provider = vi.fn(async () => jwt(inSeconds(900)))
    const tokens = new TokenSource(jwt(inSeconds(900)), provider)

    await Promise.all([tokens.get({ force: true }), tokens.get({ force: true }), tokens.get({ force: true })])
    expect(provider).toHaveBeenCalledTimes(1)
    tokens.dispose()
  })

  it('does not schedule anything for a token without exp', async () => {
    const provider = vi.fn(() => 'opaque')
    const tokens = new TokenSource(undefined, provider)
    await tokens.get()
    await vi.advanceTimersByTimeAsync(24 * 3_600_000)
    expect(provider).toHaveBeenCalledTimes(1)
  })

  it('serves a static token as is and lets the host replace it', async () => {
    const tokens = new TokenSource('static-1')
    expect(tokens.renewable).toBe(false)
    expect(await tokens.get({ force: true })).toBe('static-1')
    tokens.set('static-2')
    expect(await tokens.get()).toBe('static-2')
  })
})
