import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import type {
  RealtimeFriendRequest,
  RealtimeMessage,
} from './realtime.types';

@Injectable()
export class RealtimeService {
  private server: Server | null = null;
  private readonly socketsByUser = new Map<string, Set<string>>();

  bindServer(server: Server) {
    this.server = server;
  }

  register(userId: string, socketId: string) {
    const sockets = this.socketsByUser.get(userId) ?? new Set<string>();
    const wasOffline = sockets.size === 0;

    sockets.add(socketId);
    this.socketsByUser.set(userId, sockets);

    if (wasOffline) {
      this.server?.emit('presence:update', { userId, online: true });
    }
  }

  unregister(userId: string, socketId: string) {
    const sockets = this.socketsByUser.get(userId);

    if (!sockets) {
      return;
    }

    sockets.delete(socketId);

    if (sockets.size > 0) {
      return;
    }

    this.socketsByUser.delete(userId);
    this.server?.emit('presence:update', { userId, online: false });
  }

  isOnline(userId: string) {
    return Boolean(this.socketsByUser.get(userId)?.size);
  }

  getOnlineUserIds() {
    return [...this.socketsByUser.keys()];
  }

  emitMessage(message: RealtimeMessage) {
    this.emitToUser(message.senderId, 'message:new', message);
    this.emitToUser(message.receiverId, 'message:new', message);
  }

  emitFriendRequest(addresseeId: string, request: RealtimeFriendRequest) {
    this.emitToUser(addresseeId, 'friend-request:new', request);
  }

  emitFriendsChanged(userIds: string[]) {
    userIds.forEach((userId) => this.emitToUser(userId, 'friends:changed', {}));
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server?.to(this.userRoom(userId)).emit(event, payload);
  }

  userRoom(userId: string) {
    return `user:${userId}`;
  }
}
