import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets'
import { Logger } from '@nestjs/common'
import { Socket } from 'socket.io'
import { IBridleGateway, type IBridleOutgoingEvent } from './domain'

/**
 * WebSocket gateway for the AGENT runtime connection.
 * The agent connects here as a client: ws://api-host/ws/agent
 *
 * Events (Agent → Hub):
 *   "register"    {}                                        — agent announces presence
 *   "message"     { clientId, text, messageId, ts }
 *   "stream"      { clientId, text, messageId, ts }
 *   "stream_end"  { clientId, text, messageId, ts }
 *   "typing"      { clientId, ts }
 *   "ping"        {}
 *
 * Events (Hub → Agent):
 *   "message"     { clientId, text, messageId, images? }   — user message to process
 *   "pong"        {}
 */
@WebSocketGateway({ namespace: '/ws/agent', cors: { origin: '*' } })
export class AgentWsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AgentWsGateway.name)

  constructor(private readonly hub: IBridleGateway) {}

  handleConnection(client: Socket) {
    this.logger.log('Agent socket connected')

    const send = (data: unknown) => {
      const event = (data as Record<string, unknown>)?.type as string ?? 'data'
      client.emit(event, data)
    }

    this.hub.registerAgent(send)
  }

  handleDisconnect() {
    this.logger.warn('Agent socket disconnected')
    this.hub.unregisterAgent()
  }

  @SubscribeMessage('message')
  handleMessage(@MessageBody() data: IBridleOutgoingEvent) {
    if (data?.clientId) {
      this.hub.handleAgentEvent({ ...data, type: 'message' })
    }
  }

  @SubscribeMessage('stream')
  handleStream(@MessageBody() data: IBridleOutgoingEvent) {
    if (data?.clientId) {
      this.hub.handleAgentEvent({ ...data, type: 'stream' })
    }
  }

  @SubscribeMessage('stream_end')
  handleStreamEnd(@MessageBody() data: IBridleOutgoingEvent) {
    if (data?.clientId) {
      this.hub.handleAgentEvent({ ...data, type: 'stream_end' })
    }
  }

  @SubscribeMessage('typing')
  handleTyping(@MessageBody() data: IBridleOutgoingEvent) {
    if (data?.clientId) {
      this.hub.handleAgentEvent({ ...data, type: 'typing' })
    }
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit('pong', {})
  }
}
