import { Controller, Post, Get, Delete, Body, HttpCode, Param, Query, Req, Logger } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBody, ApiOkResponse, ApiQuery } from '@nestjs/swagger'
import { IBridleGateway, IBridleTranscriptGateway, buildParts } from './domain'
import { SendMessageDto, BridleHealthDto, BridleBotHealthDto, TranscriptResponseDto } from './dtos'
import { FlatResponse } from './core'

@ApiTags('bridle')
@Controller('api/agent')
export class BridleController {
  private readonly logger = new Logger(BridleController.name)

  constructor(
    private readonly hub: IBridleGateway,
    private readonly transcripts: IBridleTranscriptGateway,
  ) {}

  @ApiOperation({ description: 'Send a message to a bot agent (HTTP fallback — fire & forget)', operationId: 'sendBridleMessage' })
  @ApiBody({ type: SendMessageDto })
  @FlatResponse()
  @Post(':agentId/message')
  @HttpCode(200)
  async sendMessage(
    @Param('agentId') agentId: string,
    @Req() req: Record<string, unknown>,
    @Body() body: SendMessageDto,
  ) {
    const user = req.user as Record<string, unknown> | undefined
    const clientId = (user?.id as string) ?? 'http-' + crypto.randomUUID()
    const parts = body.parts ?? buildParts(body.text, body.images)
    this.hub.sendToAgent(clientId, agentId, body.text, parts)
    return { ok: true }
  }

  @ApiOperation({ description: 'Send a message and wait for the bot agent response (synchronous)', operationId: 'sendBridleMessageSync' })
  @ApiBody({ type: SendMessageDto })
  @FlatResponse()
  @Post(':agentId/message/sync')
  @HttpCode(200)
  async sendMessageSync(
    @Param('agentId') agentId: string,
    @Req() req: Record<string, unknown>,
    @Body() body: SendMessageDto,
  ) {
    const clientId = 'sync-' + crypto.randomUUID()
    const chunks: string[] = []

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.hub.unregisterClient(clientId)
        resolve({ text: chunks.join('') || 'Timeout: no response from agent', messageId: '', ts: Date.now() })
      }, 120_000)

      this.hub.registerClient(
        clientId,
        agentId,
        (data: unknown) => {
          const event = data as Record<string, unknown>
          if (event.type === 'message' || event.type === 'stream_end') {
            clearTimeout(timeout)
            this.hub.unregisterClient(clientId)
            resolve({ text: event.text ?? chunks.join(''), messageId: event.messageId, ts: event.ts })
          } else if (event.type === 'stream') {
            chunks.push((event.text as string) ?? '')
          }
        },
        false,
      )

      const parts = body.parts ?? buildParts(body.text, body.images)
      this.hub.sendToAgent(clientId, agentId, body.text, parts)
    })
  }

  @ApiOperation({ description: 'Check overall hub status', operationId: 'bridleHealth' })
  @FlatResponse()
  @ApiOkResponse({ type: BridleHealthDto })
  @Get('health')
  async health() {
    return this.hub.health()
  }

  @ApiOperation({ description: 'Check bot agent connection status', operationId: 'bridleBotHealth' })
  @FlatResponse()
  @ApiOkResponse({ type: BridleBotHealthDto })
  @Get(':agentId/health')
  async botHealth(@Param('agentId') agentId: string) {
    return this.hub.botHealth(agentId)
  }

  @ApiOperation({ description: 'List all connected agents', operationId: 'listAgents' })
  @FlatResponse()
  @Get('list')
  async listAgents() {
    return this.hub.listAgents()
  }

  @ApiOperation({
    description:
      'Replay the persisted chat transcript for a bot. Used to restore the chat UI on page refresh — live updates still arrive via /ws/client. Returns an empty array when nothing has been persisted yet.',
    operationId: 'getBridleTranscript',
  })
  @ApiQuery({ name: 'channel', required: false, description: 'Session channel — defaults to "admin".' })
  @FlatResponse()
  @ApiOkResponse({ type: TranscriptResponseDto })
  @Get(':agentId/transcript')
  async transcript(
    @Param('agentId') agentId: string,
    @Query('channel') channelRaw?: string,
  ): Promise<TranscriptResponseDto> {
    const channel = (channelRaw ?? 'admin').trim() || 'admin'
    try {
      const messages = await this.transcripts.read(agentId, channel)
      return { messages, channel }
    } catch (err) {
      this.logger.warn(`Transcript read failed for ${agentId}/${channel}: ${(err as Error).message}`)
      return { messages: [], channel }
    }
  }

  @ApiOperation({
    description:
      'Delete the persisted chat transcript for a bot/channel. Used to start a fresh chat — the UI clears, refresh shows empty. The agent runtime\'s in-memory session may still hold context until its next restart.',
    operationId: 'resetBridleTranscript',
  })
  @ApiQuery({ name: 'channel', required: false, description: 'Session channel — defaults to "admin".' })
  @FlatResponse()
  @Delete(':agentId/transcript')
  @HttpCode(204)
  async resetTranscript(
    @Param('agentId') agentId: string,
    @Query('channel') channelRaw?: string,
  ): Promise<void> {
    const channel = (channelRaw ?? 'admin').trim() || 'admin'
    try {
      await this.transcripts.delete(agentId, channel)
    } catch (err) {
      this.logger.warn(`Transcript reset failed for ${agentId}/${channel}: ${(err as Error).message}`)
    }
  }
}
