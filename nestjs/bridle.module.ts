import { Module } from '@nestjs/common'
import { BridleController } from './bridle.controller'
import { ChatWsGateway } from './bridle.chat-ws'
import { AgentWsGateway } from './bridle.agent-ws'
import { IBridleGateway } from './domain'
import { BridleGateway } from './data'

/**
 * Bridle Module — hub between browsers and the agent.
 *
 * The agent connects to the API as a WS client on /ws/agent
 * Browsers connect on /ws/chat
 * The API routes messages between them.
 *
 * Usage:
 *
 * ```ts
 * import { BridleModule } from 'bridle/nestjs'
 *
 * @Module({
 *   imports: [BridleModule],
 * })
 * export class AppModule {}
 * ```
 *
 * WebSocket endpoints:
 *   /ws/agent  — agent runtime connection
 *   /ws/chat   — browser client connection
 *
 * HTTP endpoints:
 *   POST /api/agent/message  — HTTP fallback for sending messages
 *   GET  /api/agent/health   — agent connection status
 */
@Module({
  providers: [
    { provide: IBridleGateway, useClass: BridleGateway },
    ChatWsGateway,
    AgentWsGateway,
  ],
  controllers: [BridleController],
  exports: [IBridleGateway],
})
export class BridleModule {}
