import { Injectable } from '@nestjs/common'
import { IBridleAuthGateway } from '../domain/bridleAuth.gateway'
import { IBridleAgentAuth } from '../domain/bridleAuth.types'

/**
 * Default no-op gateway. Always returns `null`, which means:
 *   - public flow is disabled (every browser must present a JWT)
 *   - debug flag is never auto-restored on agent reconnect
 *
 * This is the historical behaviour of Bridle pre-`IBridleAuthGateway`, so
 * existing consumers see no change. Replace via DI override in your
 * AppModule to opt into per-agent public embeds and debug rehydrate.
 */
@Injectable()
export class BridleAuthNoopGateway extends IBridleAuthGateway {
  async getAgentAuth(_agentId: string): Promise<IBridleAgentAuth | null> {
    return null
  }
}
