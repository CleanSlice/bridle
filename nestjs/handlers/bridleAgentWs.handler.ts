import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets'
import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Socket } from 'socket.io'
import {
  IBridleGateway,
  IBridleAuthGateway,
  type IBridleOutgoingEvent,
  type IBridleDebugEvent,
  type IBridleSyncResponse,
} from '../domain'

/**
 * WebSocket gateway for AGENT runtime connections.
 * Agents connect here: ws://hub-host/ws/agent
 *
 * Auth: apiKey + agentId in Socket.IO handshake.
 * apiKey must match BRIDLE_API_KEY env var.
 * agentId identifies which agent this runtime serves.
 * Multiple agents can connect (one per agentId).
 *
 * Events (Agent → Hub):
 *   "register"    {}
 *   "message"     { clientId, text, messageId, ts }
 *   "stream"      { clientId, text, messageId, ts }
 *   "stream_end"  { clientId, text, messageId, ts }
 *   "typing"      { clientId, ts }
 *   "debug"       { clientId, messageId?, model, provider, systemPrompt, ... } admin-only
 *   "sync_done"   { requestId, pushed, error? }
 *   "ping"        {}
 *
 * Events (Hub → Agent):
 *   "message"     { clientId, text, messageId, images? }
 *   "debug_set"   { enabled }
 *   "sync"        { requestId }
 *   "pong"        {}
 */
@WebSocketGateway({ namespace: '/ws/agent' })
export class BridleAgentWsHandler implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(BridleAgentWsHandler.name)

  constructor(
    private readonly hub: IBridleGateway,
    private readonly config: ConfigService,
    private readonly auth: IBridleAuthGateway,
  ) {}

  handleConnection(client: Socket) {
    const auth = (client.handshake.auth ?? {}) as {
      apiKey?: string
      agentId?: string
      botId?: string
    }
    const apiKey = auth.apiKey
    // Accept legacy `botId` so runtimes still on the pre-0.3.0 SDK can
    // continue connecting through the rename window.
    const agentId = auth.agentId ?? auth.botId
    const expectedKey = this.config.get<string>('BRIDLE_API_KEY')

    if (!apiKey || !agentId || apiKey !== expectedKey) {
      this.logger.warn(`Agent connection rejected: invalid credentials (agentId: ${agentId ?? 'none'})`)
      client.disconnect(true)
      return
    }

    client.data = { agentId }

    const send = (data: unknown) => {
      const event = (data as Record<string, unknown>)?.type as string ?? 'data'
      client.emit(event, data)
    }

    this.hub.registerAgent(agentId, send)
    this.logger.log(`Agent connected: agentId=${agentId}`)

    // Re-apply debug flag so a freshly-started runtime picks up whatever the
    // admin toggled while it was offline. Fire-and-forget — debug is non-
    // critical and the WS handshake must not block on a DB query. Returns
    // null (= skip) when the consumer hasn't overridden IBridleAuthGateway.
    this.auth
      .getAgentAuth(agentId)
      .then((agentAuth) => {
        if (agentAuth?.debugEnabled) {
          this.hub.setDebug(agentId, true)
        }
      })
      .catch((err: Error) => {
        this.logger.warn(`Debug rehydrate failed for ${agentId}: ${err.message}`)
      })
  }

  handleDisconnect(client: Socket) {
    const agentId = client.data?.agentId as string | undefined
    if (agentId) {
      this.hub.unregisterAgent(agentId)
      this.logger.warn(`Agent disconnected: agentId=${agentId}`)
    }
  }

  @SubscribeMessage('message')
  handleMessage(@ConnectedSocket() client: Socket, @MessageBody() data: IBridleOutgoingEvent) {
    const agentId = client.data?.agentId as string
    if (data?.clientId && agentId) {
      this.hub.handleAgentEvent(agentId, { ...data, type: 'message' })
    }
  }

  @SubscribeMessage('stream')
  handleStream(@ConnectedSocket() client: Socket, @MessageBody() data: IBridleOutgoingEvent) {
    const agentId = client.data?.agentId as string
    if (data?.clientId && agentId) {
      this.hub.handleAgentEvent(agentId, { ...data, type: 'stream' })
    }
  }

  @SubscribeMessage('stream_end')
  handleStreamEnd(@ConnectedSocket() client: Socket, @MessageBody() data: IBridleOutgoingEvent) {
    const agentId = client.data?.agentId as string
    if (data?.clientId && agentId) {
      this.hub.handleAgentEvent(agentId, { ...data, type: 'stream_end' })
    }
  }

  @SubscribeMessage('typing')
  handleTyping(@ConnectedSocket() client: Socket, @MessageBody() data: IBridleOutgoingEvent) {
    const agentId = client.data?.agentId as string
    if (data?.clientId && agentId) {
      this.hub.handleAgentEvent(agentId, { ...data, type: 'typing' })
    }
  }

  @SubscribeMessage('debug')
  handleDebug(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleDebugEvent,
  ) {
    const agentId = client.data?.agentId as string
    if (agentId) {
      this.hub.handleDebugEvent(agentId, { ...data, type: 'debug' })
    }
  }

  @SubscribeMessage('sync_done')
  handleSyncDone(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IBridleSyncResponse,
  ) {
    const agentId = client.data?.agentId as string
    if (agentId && data?.requestId) {
      this.hub.handleSyncResponse(agentId, data)
    }
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit('pong', {})
  }
}
