import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';
import type {
  RealtimeFriendRequest,
  RealtimeMessage,
} from './realtime.types';

const DEFAULT_PRESENCE_OFFLINE_GRACE_MS = 45_000;

function readOfflineGraceMs() {
  const value = Number(process.env.PRESENCE_OFFLINE_GRACE_MS ?? '');

  return Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_PRESENCE_OFFLINE_GRACE_MS;
}

@Injectable()
export class RealtimeService {
  private server: Server | null = null;
  private readonly socketsByUser = new Map<string, Set<string>>();
  private readonly pendingOfflineTimers = new Map<string, NodeJS.Timeout>();
  private readonly offlineGraceMs = readOfflineGraceMs();

  bindServer(server: Server) {
    this.server = server;
  }

  register(userId: string, socketId: string) {
    const sockets = this.socketsByUser.get(userId) ?? new Set<string>();
    const hadPendingOffline = this.pendingOfflineTimers.has(userId);
    const wasOffline = sockets.size === 0 && !hadPendingOffline;

    this.clearPendingOffline(userId);

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

    if (this.offlineGraceMs === 0) {
      this.server?.emit('presence:update', { userId, online: false });
      return;
    }

    this.clearPendingOffline(userId);

    const timer = setTimeout(() => {
      this.pendingOfflineTimers.delete(userId);

      if (this.socketsByUser.get(userId)?.size) {
        return;
      }

      this.server?.emit('presence:update', { userId, online: false });
    }, this.offlineGraceMs);

    this.pendingOfflineTimers.set(userId, timer);
  }

  isOnline(userId: string) {
    return (
      Boolean(this.socketsByUser.get(userId)?.size) ||
      this.pendingOfflineTimers.has(userId)
    );
  }

  getOnlineUserIds() {
    return [...new Set([
      ...this.socketsByUser.keys(),
      ...this.pendingOfflineTimers.keys(),
    ])];
  }

  private clearPendingOffline(userId: string) {
    const timer = this.pendingOfflineTimers.get(userId);

    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.pendingOfflineTimers.delete(userId);
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
