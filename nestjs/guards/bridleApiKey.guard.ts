import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Request } from 'express'

/**
 * HTTP guard that validates the `x-bridle-api-key` header against the
 * `BRIDLE_API_KEY` env var — same secret the agent runtimes use to
 * authenticate to /ws/agent. Useful when you expose admin-only endpoints
 * (sync, debug toggle, etc.) and want them gated by the existing shared
 * secret instead of standing up a separate auth scheme.
 *
 * Not applied to the default `BridleController` routes — opt in per-route
 * by decorating with `@UseGuards(BridleApiKeyGuard)` in your own controller.
 */
@Injectable()
export class BridleApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>()
    const header = req.headers['x-bridle-api-key']
    const presented = Array.isArray(header) ? header[0] : header
    const expected = this.config.get<string>('BRIDLE_API_KEY')
    if (!expected || presented !== expected) {
      throw new UnauthorizedException('Invalid bridle api key')
    }
    return true
  }
}
