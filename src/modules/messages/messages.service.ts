import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FriendsService } from '../friends/friends.service';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly friendsService: FriendsService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async listConversation(userId: string, friendId: string) {
    await this.friendsService.ensureFriends(userId, friendId);

    await this.prisma.message.updateMany({
      where: {
        senderId: friendId,
        receiverId: userId,
        readAt: null,
      },
      data: { readAt: new Date() },
    });

    const messages = await this.prisma.message.findMany({
      where: {
        OR: [
          { senderId: userId, receiverId: friendId },
          { senderId: friendId, receiverId: userId },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map((message) => ({
      id: message.id,
      senderId: message.senderId,
      receiverId: message.receiverId,
      encryptedContent: message.encryptedContent,
      encryptionIv: message.encryptionIv,
      encryptionVersion: message.encryptionVersion,
      createdAt: message.createdAt,
      isMe: message.senderId === userId,
    }));
  }

  async send(
    userId: string,
    friendId: string,
    encryptedContent: string,
    encryptionIv: string,
  ) {
    const friend = await this.prisma.user.findUnique({ where: { id: friendId } });

    if (!friend) {
      throw new NotFoundException('好友不存在');
    }

    await this.friendsService.ensureFriends(userId, friendId);

    const message = await this.prisma.message.create({
      data: {
        senderId: userId,
        receiverId: friendId,
        encryptedContent,
        encryptionIv,
      },
    });

    this.realtimeService.emitMessage({
      id: message.id,
      senderId: message.senderId,
      receiverId: message.receiverId,
      createdAt: message.createdAt,
      encryptedContent: message.encryptedContent,
      encryptionIv: message.encryptionIv,
    });

    return {
      id: message.id,
      senderId: message.senderId,
      receiverId: message.receiverId,
      encryptedContent: message.encryptedContent,
      encryptionIv: message.encryptionIv,
      encryptionVersion: message.encryptionVersion,
      createdAt: message.createdAt,
      isMe: true,
    };
  }
}
