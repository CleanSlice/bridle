import { ApiProperty } from '@nestjs/swagger'
import type { IBridleHealthData } from '../domain'

export class BridleHealthDto implements IBridleHealthData {
  @ApiProperty({ example: true })
  ok: boolean

  @ApiProperty({ description: 'Whether the agent runtime is connected via WebSocket' })
  agentConnected: boolean

  @ApiProperty({ description: 'Number of browser clients connected' })
  browserClients: number
}
