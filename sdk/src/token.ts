/**
 * Where the widget gets its hub token from (CLEAN-188).
 *
 * Embed tokens are short-lived on purpose — the long-lived credential is the
 * integrator's server-side API key — so the widget has to keep asking for new
 * ones. A `TokenSource` wraps the integrator's provider and answers every
 * "I need a token" from the socket handshake and the HTTP calls:
 *
 *   - the current token is cached until ~60 s before its `exp`, so the
 *     provider is not called on every reconnect or request;
 *   - a timer renews it ~60 s before `exp`, so a reconnect after a long idle
 *     already carries a valid token;
 *   - `get({ force: true })` bypasses the cache, for when the hub has turned
 *     the current token away;
 *   - concurrent callers share one in-flight provider call.
 *
 * Without a provider the source only holds a static token, which the host
 * page can replace with `set()`.
 */

export type TokenProvider = () => string | Promise<string>

export interface ITokenSourceOptions {
  /** Renew this long before `exp` (ms). Default 60 s. */
  refreshBeforeMs?: number
  /** Clock, injectable for tests. */
  now?: () => number
}

export interface IGetTokenOptions {
  /** Skip the cache and ask the provider, e.g. after the hub rejected the token. */
  force?: boolean
}

const DEFAULT_REFRESH_BEFORE_MS = 60_000

export class TokenSource {
  private token: string | null
  private expiresAt: number | null = null
  private inFlight: Promise<string> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly refreshBeforeMs: number
  private readonly now: () => number

  constructor(
    initial: string | undefined,
    private provider?: TokenProvider,
    options: ITokenSourceOptions = {},
  ) {
    this.refreshBeforeMs = options.refreshBeforeMs ?? DEFAULT_REFRESH_BEFORE_MS
    this.now = options.now ?? Date.now
    this.token = null
    if (initial) this.store(initial)
    else if (!provider) this.token = ''
  }

  /** True when an expired or rejected token can be replaced without the host page. */
  get renewable(): boolean {
    return typeof this.provider === 'function'
  }

  async get(options: IGetTokenOptions = {}): Promise<string> {
    if (!this.provider) return this.token ?? ''
    if (!options.force && this.token !== null && !this.expiringSoon()) return this.token
    return this.fetch()
  }

  /** Replace the token from outside (the host's `setToken`, or a new attribute value). */
  set(token: string): void {
    this.store(token)
  }

  /** Swap the provider, e.g. when the host assigns a new `tokenProvider`. */
  setProvider(provider: TokenProvider | undefined): void {
    this.provider = provider
    if (!provider) this.clearTimer()
    else this.schedule()
  }

  /** Stop the proactive timer. The source still answers `get()`. */
  dispose(): void {
    this.clearTimer()
  }

  private fetch(): Promise<string> {
    const provider = this.provider
    if (!provider) return Promise.resolve(this.token ?? '')
    if (!this.inFlight) {
      this.inFlight = Promise.resolve()
        .then(() => provider())
        .then((token) => {
          this.store(token ?? '')
          return this.token ?? ''
        })
        .finally(() => {
          this.inFlight = null
        })
    }
    return this.inFlight
  }

  private store(token: string): void {
    this.token = token
    this.expiresAt = jwtExpiresAt(token)
    this.schedule()
  }

  private expiringSoon(): boolean {
    return this.expiresAt !== null && this.expiresAt - this.now() <= this.refreshBeforeMs
  }

  private schedule(): void {
    this.clearTimer()
    // Without a provider there is nothing to renew with; without `exp`
    // (public / anonymous embeds) there is nothing to renew before.
    if (!this.provider || this.expiresAt === null) return
    const delay = Math.max(0, this.expiresAt - this.refreshBeforeMs - this.now())
    this.timer = setTimeout(() => {
      this.timer = null
      // A failed proactive renewal is not fatal: the token is still valid for
      // up to a minute, and the next `get()` or rejection tries again.
      this.fetch().catch(() => undefined)
    }, delay)
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

/**
 * `exp` of a JWT in ms, read from the payload without verifying it — the hub
 * verifies; the widget only needs to know when to ask for the next one.
 * `null` for anything that is not a JWT with a numeric `exp`.
 */
export function jwtExpiresAt(token: string): number | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const claims = JSON.parse(atob(padded)) as { exp?: unknown }
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null
  } catch {
    return null
  }
}
