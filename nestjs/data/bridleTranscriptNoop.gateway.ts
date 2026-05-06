import { Injectable, Logger } from '@nestjs/common'
import { IBridleTranscriptGateway } from '../domain/bridleTranscript.gateway'
import { IBridleTranscriptMessage } from '../domain/bridleTranscript.types'

/**
 * Default no-op gateway. Returns an empty transcript and silently accepts
 * deletes — keeps Bridle working out of the box even when the consumer
 * hasn't wired persistence yet. Logs once on first call so the omission
 * is visible in dev. Replace via DI override in your AppModule.
 */
@Injectable()
export class BridleTranscriptNoopGateway extends IBridleTranscriptGateway {
  private readonly logger = new Logger(BridleTranscriptNoopGateway.name)
  private warned = false

  private warnOnce(action: string): void {
    if (this.warned) return
    this.warned = true
    this.logger.warn(
      `IBridleTranscriptGateway is using the no-op default — ${action} returns no data. ` +
        `Override this provider in your AppModule to enable transcript replay & reset.`,
    )
  }

  async read(): Promise<IBridleTranscriptMessage[]> {
    this.warnOnce('read')
    return []
  }

  async delete(): Promise<void> {
    this.warnOnce('delete')
  }
}
