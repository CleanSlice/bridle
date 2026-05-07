import { IBridleTranscriptMessage } from './bridleTranscript.types'

/**
 * Persistence contract for chat transcripts.
 *
 * Bridle is a stateless WS hub — it doesn't own the messages. Consumers
 * supply a concrete implementation that knows where the agent runtime
 * persists conversation history (S3/MinIO bucket, local filesystem,
 * Postgres, etc.) so the controller can replay it on refresh and clear
 * it for a "new chat" action.
 *
 * Override the default no-op binding in your AppModule:
 *
 * ```ts
 * @Module({
 *   imports: [BridleModule],
 *   providers: [
 *     { provide: IBridleTranscriptGateway, useClass: MyTranscriptGateway },
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
export abstract class IBridleTranscriptGateway {
  /**
   * Return the transcript for `(agentId, channel)` ordered oldest→newest.
   * Return `[]` when nothing has been persisted yet — never throw on a
   * missing transcript, that's the steady state for new bots.
   */
  abstract read(
    agentId: string,
    channel: string,
  ): Promise<IBridleTranscriptMessage[]>

  /**
   * Delete the transcript for `(agentId, channel)`. Idempotent — must
   * succeed when nothing exists.
   */
  abstract delete(agentId: string, channel: string): Promise<void>
}
