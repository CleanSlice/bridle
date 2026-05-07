import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets'
import { Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Server, Socket } from 'socket.io'
import { IBridleGateway, type BridlePart, buildParts } from '../domain'

/**
 * WebSocket gateway for BROWSER clients.
 * Browsers connect here: ws://hub-host/ws/client
 *
 * Auth: JWT token + agentId in Socket.IO handshake.
 * Token is verified via JwtService. agentId scopes the chat to a specific bot.
 *
 * Admin detection: if JWT payload contains roles including 'ADMIN',
 * clientId is set to 'admin' so the runtime's access control recognizes it.
 *
 * Events (browser → hub):
 *   "message"  { text, images? }
 *   "ping"     {}
 *
 * Events (hub → browser):
 *   "welcome"     { clientId }
 *   "message"     { text, messageId, ts }
 *   "stream"      { text, messageId, ts }
 *   "stream_end"  { text, messageId, ts }
 *   "typing"      { ts }
 *   "pong"        { ts }
 */
@WebSocketGateway({ namespace: '/ws/client' })
export class BridleClientWsHandler implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server

  private readonly logger = new Logger(BridleClientWsHandler.name)

  constructor(
    private readonly hub: IBridleGateway,
    private readonly jwt: JwtService,
  ) {}

  handleConnection(client: Socket) {
    const auth = (client.handshake.auth ?? {}) as {
      token?: string
      agentId?: string
      botId?: string
    }
    const token = auth.token
    // Accept legacy `botId` from cached pre-0.3.0 SDK bundles in the wild.
    const agentId = auth.agentId ?? auth.botId

    if (!token || !agentId) {
      this.logger.warn('Browser connection rejected: missing token or agentId')
      client.disconnect(true)
      return
    }

    let payload: Record<string, unknown>
    try {
      payload = this.jwt.verify(token) as Record<string, unknown>
    } catch {
      this.logger.warn('Browser connection rejected: invalid JWT')
      client.disconnect(true)
      return
    }

    const roles = payload.roles as string[] | undefined
    const isAdmin = Array.isArray(roles) && roles.includes('ADMIN')
    const clientId = isAdmin ? 'admin' : (payload.sub as string)

    client.data = { clientId, agentId, email: payload.email, isAdmin }

    const send = (data: unknown) => {
      const event = (data as Record<string, unknown>)?.type as string ?? 'data'
      client.emit(event, data)
    }

    this.hub.registerClient(clientId, agentId, send, isAdmin)
    client.emit('welcome', { clientId })

    this.logger.log(`Browser connected: clientId=${clientId} agentId=${agentId} admin=${isAdmin}`)
  }

  handleDisconnect(client: Socket) {
    const clientId = client.data?.clientId as string | undefined
    if (clientId) {
      this.hub.unregisterClient(clientId)
      this.logger.log(`Browser disconnected: clientId=${clientId}`)
    }
  }

  @SubscribeMessage('message')
  handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { text?: string; parts?: BridlePart[]; images?: Array<{ base64: string; mediaType: string }> },
  ) {
    const clientId = client.data?.clientId as string
    const agentId = client.data?.agentId as string
    if (!clientId || !agentId) return

    const text = data.text ?? ''
    const parts = data.parts ?? buildParts(text, data.images)
    if (!text && parts.length === 0) return

    this.hub.sendToAgent(clientId, agentId, text, parts)
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket) {
    client.emit('pong', { ts: Date.now() })
  }
}
