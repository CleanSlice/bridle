/**
 * Stand-in for a socket.io client socket wired to a fake hub. It behaves like
 * Ranch's `/ws/client` handler where it matters for tokens: the handshake
 * calls `auth` (a callback, so the token is read per attempt), a rejected
 * token is accepted first, then answered with `bridle_error` and dropped
 * server-side — after which socket.io does NOT reconnect on its own.
 */
type Handler = (...args: any[]) => void
type AuthPayload = { token: string } & Record<string, unknown>
type AuthOption = (cb: (data: AuthPayload) => void) => void

export interface IHub {
  /** Called on every handshake; return the rejection code, or null to welcome. */
  check: (auth: AuthPayload) => string | null
  /** Optional: a non-fatal warning to emit after an accepted handshake. */
  warn?: (auth: AuthPayload) => string | null
}

export const sockets: FakeSocket[] = []
export const hub: IHub = { check: () => null }

export class FakeSocket {
  readonly handshakes: AuthPayload[] = []
  readonly sent: unknown[] = []
  connected = false
  private handlers = new Map<string, Handler[]>()

  constructor(private readonly auth: AuthOption) {
    sockets.push(this)
    queueMicrotask(() => this.connect())
  }

  on(event: string, handler: Handler): this {
    const list = this.handlers.get(event) ?? []
    list.push(handler)
    this.handlers.set(event, list)
    return this
  }

  emit(event: string, payload: unknown): this {
    if (event === 'message') this.sent.push(payload)
    return this
  }

  connect(): this {
    this.auth((data) => {
      this.handshakes.push(data)
      this.connected = true
      this.trigger('connect')
      const rejection = hub.check(data)
      if (rejection) {
        this.trigger('bridle_error', { code: rejection })
        this.connected = false
        this.trigger('disconnect', 'io server disconnect')
        return
      }
      const warning = hub.warn?.(data)
      if (warning) this.trigger('bridle_warning', { code: warning })
      this.trigger('welcome', { clientId: `visitor-of-${data.token || 'anon'}` })
    })
    return this
  }

  disconnect(): this {
    this.connected = false
    this.trigger('disconnect', 'io client disconnect')
    return this
  }

  /** Transport loss (network drop, sleep): socket.io reconnects by itself. */
  drop(): void {
    this.connected = false
    this.trigger('disconnect', 'transport close')
    this.connect()
  }

  trigger(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args)
  }
}

export function resetFakes(): void {
  sockets.length = 0
  hub.check = () => null
  hub.warn = undefined
}

/** `vi.mock('socket.io-client', ...)` factory. */
export const socketIoMock = () => ({
  io: (_url: string, opts: { auth: AuthOption }) => new FakeSocket(opts.auth),
})

/** A JWT whose payload carries `exp` (seconds). Not signed — the SDK never verifies. */
export function jwt(exp: number, sub = 'visitor'): string {
  const encode = (o: object) =>
    btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub, exp })}.sig`
}

/** Let queued microtasks and promise chains settle. */
export async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}
