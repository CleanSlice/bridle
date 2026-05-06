import { IoAdapter } from '@nestjs/platform-socket.io'
import type { INestApplicationContext } from '@nestjs/common'
import type { ServerOptions } from 'socket.io'

/**
 * Socket.IO adapter that forwards a CORS origin list (from BRIDLE's
 * `CORS_ORIGINS` env) to all `@WebSocketGateway` namespaces. NestJS's
 * `app.enableCors()` only handles REST — the Socket.IO server has its
 * own CORS pipeline that we configure here.
 */
export class CorsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origin: string[] | true,
  ) {
    super(app)
  }

  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.origin === true ? '*' : this.origin,
        credentials: true,
      },
    })
  }
}

/**
 * Parse the `CORS_ORIGINS` env value into an array of origins, or `true`
 * to mean "allow any origin". Empty / unset → wildcard (development).
 *
 *   CORS_ORIGINS=https://a.com,https://b.com  → ['https://a.com', 'https://b.com']
 *   CORS_ORIGINS=*                            → true
 *   CORS_ORIGINS unset                        → true
 */
export function parseCorsOrigins(raw: string | undefined): string[] | true {
  if (!raw || raw.trim() === '' || raw.trim() === '*') return true
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
}
