/**
 * Per-agent metadata used by the hub to decide:
 *  - whether anonymous browser embeds are allowed (origin-whitelisted public flow)
 *  - whether the agent runtime should boot with debug snapshots enabled
 *
 * Returned by `IBridleAuthGateway.getAgentAuth(agentId)`. The default no-op
 * implementation returns `null`, which keeps the hub in JWT-only mode.
 */
export interface IBridleAgentAuth {
  /**
   * When true and the browser request `Origin` is in `allowedOrigins`, the
   * client connects without a JWT and gets an anonymous clientId.
   */
  isPublic: boolean
  /**
   * Origins authorized to open anonymous browser WebSockets. Only consulted
   * when `isPublic` is true. Compared exactly (scheme + host + port).
   */
  allowedOrigins: string[]
  /**
   * Re-applied after the agent runtime reconnects so debug stays sticky
   * across restarts. Optional — undefined leaves whatever the runtime
   * defaulted to.
   */
  debugEnabled?: boolean
}
