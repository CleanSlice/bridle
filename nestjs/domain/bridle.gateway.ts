import type { IBridleHealthData, IBridleImageData, IBridleOutgoingEvent } from './bridle.types'

/**
 * Hub gateway — manages connections from agent and browser clients.
 * Routes messages between them.
 */
export abstract class IBridleGateway {
  /** Send a message from a browser client to the agent */
  abstract sendToAgent(clientId: string, text: string, images?: IBridleImageData[]): void
  /** Send an event from the agent to a specific browser client */
  abstract sendToClient(clientId: string, data: unknown): void
  /** Register a browser client */
  abstract registerClient(clientId: string, send: (data: unknown) => void): void
  /** Unregister a browser client */
  abstract unregisterClient(clientId: string): void
  /** Register the agent connection */
  abstract registerAgent(send: (data: unknown) => void): void
  /** Unregister the agent connection */
  abstract unregisterAgent(): void
  /** Handle an event from the agent — route it to the target browser client */
  abstract handleAgentEvent(data: IBridleOutgoingEvent): void
  /** Health status */
  abstract health(): IBridleHealthData
}
