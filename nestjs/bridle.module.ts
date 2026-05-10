import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { BridleController } from './bridle.controller'
import { BridleClientWsHandler, BridleAgentWsHandler } from './handlers'
import {
  IBridleGateway,
  IBridleTranscriptGateway,
  IBridleAuthGateway,
} from './domain'
import {
  BridleGateway,
  BridleTranscriptNoopGateway,
  BridleAuthNoopGateway,
  BridleAuthDemoGateway,
} from './data'
import { BridleApiKeyGuard } from './guards'

/**
 * Bridle Module — authenticated hub between browsers and agents.
 *
 * Agents connect via /ws/agent (auth: apiKey + agentId).
 * Browsers connect via /ws/client (auth: JWT token + agentId).
 * Multiple agents can connect simultaneously — each scoped by agentId.
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
 * Requires:
 *   - ConfigModule (for BRIDLE_API_KEY)
 *   - JwtModule (for browser JWT verification)
 *
 * WebSocket endpoints:
 *   /ws/agent  — agent runtime connection (apiKey + agentId)
 *   /ws/client   — browser client connection (JWT + agentId)
 *
 * HTTP endpoints:
 *   POST   /api/agent/:agentId/message       — fire & forget
 *   POST   /api/agent/:agentId/message/sync  — synchronous (120s timeout)
 *   GET    /api/agent/health               — overall hub status
 *   GET    /api/agent/:agentId/health        — per-agent status
 *   GET    /api/agent/:agentId/transcript    — replay persisted chat history
 *   DELETE /api/agent/:agentId/transcript    — clear chat history ("new chat")
 *
 * Transcript persistence is consumer-owned. By default `IBridleTranscriptGateway`
 * is bound to a no-op stub; override in your AppModule providers to enable it.
 */
@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET', 'bridle-dev-secret'),
        signOptions: { expiresIn: '24h' },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    { provide: IBridleGateway, useClass: BridleGateway },
    { provide: IBridleTranscriptGateway, useClass: BridleTranscriptNoopGateway },
    {
      // Default to no-op so the production behaviour is unchanged.
      // When `BRIDLE_DEMO_PUBLIC_ORIGINS` is set (comma-separated origin list),
      // swap in the demo gateway — useful for the embed test rig.
      provide: IBridleAuthGateway,
      useFactory: (config: ConfigService) => {
        const raw = config.get<string>('BRIDLE_DEMO_PUBLIC_ORIGINS')
        if (!raw) return new BridleAuthNoopGateway()
        const origins = raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        return new BridleAuthDemoGateway(origins)
      },
      inject: [ConfigService],
    },
    BridleClientWsHandler,
    BridleAgentWsHandler,
    BridleApiKeyGuard,
  ],
  controllers: [BridleController],
  exports: [
    IBridleGateway,
    IBridleTranscriptGateway,
    IBridleAuthGateway,
    BridleApiKeyGuard,
  ],
})
export class BridleModule {}
