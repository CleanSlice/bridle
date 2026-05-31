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
   * missing transcript, that's the steady state for newly created agents.
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

  /**
   * Move the transcript for `(agentId, channel)` aside so subsequent
   * `read()` calls return an empty list, without losing the data — used
   * by the embed's "New chat" action when the visitor wants a fresh
   * conversation but the integrator wants to keep the history for
   * admin/audit. Implementations typically rename the live file with
   * a timestamp suffix (e.g. `bridle:<channel>.<iso-ts>.archived.jsonl`)
   * and return that path. Returning `{}` is fine when nothing was
   * there to archive in the first place.
   *
   * Default implementation falls back to `delete()` — integrators can
   * upgrade by overriding this method.
   */
  async archive(agentId: string, channel: string): Promise<{ archivedPath?: string }> {
    await this.delete(agentId, channel)
    return {}
  }
}
