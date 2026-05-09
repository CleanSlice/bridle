import { IBridleAgentAuth } from './bridleAuth.types'

/**
 * Per-agent auth lookup contract.
 *
 * Bridle's hub is stateless — it doesn't own the agent registry. Consumers
 * supply a concrete implementation that knows where agent records live
 * (Postgres, in-memory map, JSON file, etc.) so the hub can answer:
 *
 *   - "Can this browser connect anonymously from this origin?" (public flow)
 *   - "Should I re-enable debug snapshots when this agent reconnects?"
 *
 * Override the default no-op binding in your AppModule:
 *
 * ```ts
 * @Module({
 *   imports: [BridleModule],
 *   providers: [
 *     { provide: IBridleAuthGateway, useClass: MyAuthGateway },
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * When this gateway returns `null` for an agentId, the hub falls back to
 * JWT-only auth and never re-applies the debug flag — i.e. the same
 * behaviour Bridle had before this gateway existed.
 */
export abstract class IBridleAuthGateway {
  /**
   * Return auth metadata for a known agent, or `null` when nothing is known
   * about this agentId. Returning `null` is the safe default — it makes the
   * hub require a JWT and skip debug rehydrate. Never throw on a missing
   * agent.
   */
  abstract getAgentAuth(agentId: string): Promise<IBridleAgentAuth | null>
}
