import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server } from 'socket.io';
import { resolveCorsOrigins } from '../../common/utils/cors';
import { JwtService } from '../auth/jwt.service';
import { RealtimeService } from './realtime.service';
import type { AuthenticatedSocket } from './realtime.types';

function readSocketTimeout(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? '');

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

@WebSocketGateway({
  cors: {
    origin: resolveCorsOrigins(),
    credentials: true,
  },
  pingInterval: readSocketTimeout(process.env.SOCKET_PING_INTERVAL_MS, 25_000),
  pingTimeout: readSocketTimeout(process.env.SOCKET_PING_TIMEOUT_MS, 60_000),
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly realtimeService: RealtimeService,
  ) {}

  afterInit(server: Server) {
    this.realtimeService.bindServer(server);
  }

  handleConnection(client: AuthenticatedSocket) {
    const token = this.extractToken(client);

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const user = this.jwtService.verify(token);

      client.data.user = user;
      client.join(this.realtimeService.userRoom(user.sub));
      this.realtimeService.register(user.sub, client.id);
      client.emit('presence:snapshot', {
        userIds: this.realtimeService.getOnlineUserIds(),
      });
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.data.user?.sub;

    if (userId) {
      this.realtimeService.unregister(userId, client.id);
    }
  }

  private extractToken(client: AuthenticatedSocket) {
    const authToken = client.handshake.auth?.token;

    if (typeof authToken === 'string') {
      return authToken;
    }

    const authHeader = client.handshake.headers.authorization;

    if (!authHeader) {
      return null;
    }

    const [bearer, token] = authHeader.split(' ');

    return bearer === 'Bearer' ? token : null;
  }
}
