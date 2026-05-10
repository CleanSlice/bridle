import { Injectable } from '@nestjs/common'
import { IBridleAuthGateway } from '../domain/bridleAuth.gateway'
import { IBridleAgentAuth } from '../domain/bridleAuth.types'

/**
 * Demo gateway for local development and the embed test rig.
 *
 * Reads `BRIDLE_DEMO_PUBLIC_ORIGINS` (comma-separated) and reports every
 * agentId as public with that origin allowlist. Lets you exercise the
 * `ORIGIN_NOT_ALLOWED` and public-anonymous flows without standing up a
 * real per-agent registry.
 *
 * Wired in `BridleModule` only when the env var is set — production keeps
 * the no-op binding.
 */
@Injectable()
export class BridleAuthDemoGateway extends IBridleAuthGateway {
  constructor(private readonly allowedOrigins: string[]) {
    super()
  }

  async getAgentAuth(_agentId: string): Promise<IBridleAgentAuth | null> {
    return {
      isPublic: true,
      allowedOrigins: this.allowedOrigins,
    }
  }
}
