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
import {
  IBridleGateway,
  IBridleAuthGateway,
  type BridlePart,
  buildParts,
} from '../domain'

/**
 * WebSocket gateway for BROWSER clients.
 * Browsers connect here: ws://hub-host/ws/client
 *
 * Auth (two paths):
 *   1. Public flow — IBridleAuthGateway returns `{ isPublic: true, allowedOrigins }`
 *      for the agentId AND the request `Origin` header is in `allowedOrigins`.
 *      No JWT required; clientId is anonymous (`anon-<random>`).
 *   2. Authenticated — JWT token + agentId in handshake auth, JWT verified.
 *      Admin role grants `clientId = "admin"` for runtime ACL.
 *
 * Handshake auth fields:
 *   `token`, `agentId`, optional `prompt` (integrator-supplied context that
 *   the hub forwards on every outgoing message to the agent).
 *
 * The default `IBridleAuthGateway` implementation always returns `null`, so
 * out of the box every connection takes path 2.
 *
 * Events (browser → hub):
 *   "message"  { text, images? }
 *   "ping"     {}
 *
 * Events (hub → browser):
 *   "welcome"       { clientId }
 *   "agent_status"  { agentId, connected }    // current state, then on every register/unregister
 *   "message"       { text, messageId, ts }
 *   "stream"        { text, messageId, ts }
 *   "stream_end"    { text, messageId, ts }
 *   "typing"        { ts }
 *   "pong"          { ts }
 *   "bridle_error"  { code, agentId?, origin? }  // emitted just before a rejected handshake disconnects, so the SDK can show a reason
 */
@WebSocketGateway({ namespace: '/ws/client' })
export class BridleClientWsHandler implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server

  private readonly logger = new Logger(BridleClientWsHandler.name)

  constructor(
    private readonly hub: IBridleGateway,
    private readonly jwt: JwtService,
    private readonly auth: IBridleAuthGateway,
  ) {}

  async handleConnection(client: Socket) {
    const handshakeAuth = (client.handshake.auth ?? {}) as {
      token?: string
      agentId?: string
      botId?: string
      prompt?: string
    }
    // Accept legacy `botId` from cached pre-0.3.0 SDK bundles in the wild.
    const agentId = handshakeAuth.agentId ?? handshakeAuth.botId
    const origin = client.handshake.headers.origin
    const prompt = handshakeAuth.prompt?.trim() || undefined

    // Emit a structured reason, then drop the connection.
    // `disconnect(true)` forces the engine.io transport closed before the
    // emit packet flushes, so the SDK never sees `bridle_error`. Plain
    // `disconnect()` sends a namespace DISCONNECT packet after the queued
    // event, preserving order on the wire.
    const reject = (code: string, extra?: Record<string, unknown>) => {
      client.emit('bridle_error', { code, agentId, origin, ...(extra ?? {}) })
      client.disconnect()
    }

    if (!agentId) {
      this.logger.warn('Browser connection rejected: missing agentId')
      return reject('MISSING_AGENT_ID')
    }

    const agentAuth = await this.auth.getAgentAuth(agentId)
    const originAllowed =
      !!agentAuth?.isPublic &&
      !!origin &&
      agentAuth.allowedOrigins.includes(origin)

    let clientId: string
    let isAdmin = false
    let email: string | undefined

    if (originAllowed) {
      // Public flow: anonymous browser session, no token required.
      clientId = `anon-${randomId()}`
      this.logger.log(
        `Browser connected (public): clientId=${clientId} agentId=${agentId} origin=${origin}`,
      )
    } else if (handshakeAuth.token) {
      // Authenticated flow: JWT required.
      let payload: Record<string, unknown>
      try {
        payload = this.jwt.verify(handshakeAuth.token) as Record<string, unknown>
      } catch {
        this.logger.warn('Browser connection rejected: invalid JWT')
        return reject('INVALID_TOKEN')
      }

      const roles = payload.roles as string[] | undefined
      isAdmin = Array.isArray(roles) && roles.includes('ADMIN')
      clientId = isAdmin ? 'admin' : (payload.sub as string)
      email = payload.email as string | undefined
    } else {
      // No token AND public flow either disabled or origin not whitelisted.
      // When the agent IS configured public, surface ORIGIN_NOT_ALLOWED so
      // the embed UI can prompt the integrator to whitelist their domain.
      const code = agentAuth?.isPublic ? 'ORIGIN_NOT_ALLOWED' : 'MISSING_TOKEN'
      this.logger.warn(
        `Browser connection rejected: ${code} (agentId=${agentId}, origin=${origin ?? 'none'})`,
      )
      return reject(code)
    }

    client.data = { clientId, agentId, email, isAdmin }

    const send = (data: unknown) => {
      const event = (data as Record<string, unknown>)?.type as string ?? 'data'
      client.emit(event, data)
    }

    this.hub.registerClient(clientId, agentId, send, isAdmin, prompt)
    client.emit('welcome', { clientId })
    // Snapshot the runtime's current online state immediately so the chat UI
    // can render the right indicator before any subsequent register/unregister
    // broadcasts arrive.
    client.emit('agent_status', {
      type: 'agent_status',
      agentId,
      connected: this.hub.isAgentConnected(agentId),
    })

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

function randomId(): string {
  return (
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  )
}
