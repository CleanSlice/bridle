import type {
  IBridleHealthData,
  IBridleAgentHealthData,
  IBridleOutgoingEvent,
  IBridleDebugEvent,
  IBridleSyncResponse,
  BridlePart,
} from './bridle.types'

/**
 * Result of a hub-initiated sync request to an agent.
 *  - `agentOnline = false` when no agent is connected for this agentId
 *  - `agentOnline = true,  pushed: N` after the agent acked
 */
export interface IBridleSyncAgentResult {
  agentOnline: boolean
  pushed: number
}

/**
 * Hub gateway — manages per-agent connections from agents and browser clients.
 * Routes messages between them, scoped by agentId.
 */
export abstract class IBridleGateway {
  /** Send a message from a browser client to the agent runtime for a specific agentId */
  abstract sendToAgent(clientId: string, agentId: string, text: string, parts: BridlePart[]): void
  /** Send an event to a specific browser client */
  abstract sendToClient(clientId: string, data: unknown): void
  /** Register a browser client for a specific agentId */
  abstract registerClient(
    clientId: string,
    agentId: string,
    send: (data: unknown) => void,
    isAdmin: boolean,
    prompt?: string,
  ): void
  /** Unregister a browser client */
  abstract unregisterClient(clientId: string): void
  /** Register an agent runtime connection for a specific agentId */
  abstract registerAgent(agentId: string, send: (data: unknown) => void): void
  /** Unregister an agent runtime connection for a specific agentId */
  abstract unregisterAgent(agentId: string): void
  /** Whether an agent runtime is currently registered for this agentId. */
  abstract isAgentConnected(agentId: string): boolean
  /** Handle an event from the agent — route to the target browser client for that agentId */
  abstract handleAgentEvent(agentId: string, data: IBridleOutgoingEvent): void
  /**
   * Handle a debug snapshot from the agent — fan out to admin clients of this
   * agentId only. Non-admin clients never see this event.
   */
  abstract handleDebugEvent(agentId: string, data: IBridleDebugEvent): void
  /**
   * Push a debug-enable/disable command to the running agent. Silently skipped
   * if the agent for agentId isn't currently connected — the next register
   * handshake should re-send the desired value.
   */
  abstract setDebug(agentId: string, enabled: boolean): void
  /**
   * Ask the agent for agentId to push its local state to remote storage and
   * resolve when the agent acks. Resolves with `agentOnline=false` immediately
   * if no agent is connected for agentId.
   */
  abstract syncAgent(agentId: string, timeoutMs?: number): Promise<IBridleSyncAgentResult>
  /** Resolve a pending syncAgent() promise by requestId. */
  abstract handleSyncResponse(agentId: string, data: IBridleSyncResponse): void
  /** Health status (all agents) */
  abstract health(): IBridleHealthData
  /** Health status for a specific agentId */
  abstract agentHealth(agentId: string): IBridleAgentHealthData
  /** List all connected agents with their client counts */
  abstract listAgents(): Array<{ agentId: string; clients: number }>
}
