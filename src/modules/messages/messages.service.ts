import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FriendsService } from '../friends/friends.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ListMessagesQueryDto, MarkMessagesReadDto } from './messages.dto';

const DEFAULT_PAGE_SIZE = 30;

type MessageCursor = {
  createdAt: string;
  id: string;
};

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly friendsService: FriendsService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async listConversation(
    userId: string,
    friendId: string,
    query: ListMessagesQueryDto,
  ) {
    await this.friendsService.ensureFriends(userId, friendId);

    const where = {
      OR: [
        { senderId: userId, receiverId: friendId },
        { senderId: friendId, receiverId: userId },
      ],
    };
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = this.decodeCursor(query.cursor);
    let messages;

    if (query.direction === 'older' && cursor) {
      messages = await this.prisma.message.findMany({
        where: {
          AND: [
            where,
            {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                {
                  createdAt: new Date(cursor.createdAt),
                  id: { lt: cursor.id },
                },
              ],
            },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      messages.reverse();
    } else if (query.direction === 'newer' && cursor) {
      messages = await this.prisma.message.findMany({
        where: {
          AND: [
            where,
            {
              OR: [
                { createdAt: { gt: new Date(cursor.createdAt) } },
                {
                  createdAt: new Date(cursor.createdAt),
                  id: { gt: cursor.id },
                },
              ],
            },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit,
      });
    } else {
      messages = await this.prisma.message.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      messages.reverse();
    }

    const oldestMessage = messages[0] ?? null;
    const newestMessage = messages.at(-1) ?? null;
    const [hasOlder, hasNewer] = await Promise.all([
      oldestMessage
        ? this.prisma.message.count({
            where: {
              AND: [
                where,
                {
                  OR: [
                    { createdAt: { lt: oldestMessage.createdAt } },
                    {
                      createdAt: oldestMessage.createdAt,
                      id: { lt: oldestMessage.id },
                    },
                  ],
                },
              ],
            },
          })
        : Promise.resolve(0),
      newestMessage
        ? this.prisma.message.count({
            where: {
              AND: [
                where,
                {
                  OR: [
                    { createdAt: { gt: newestMessage.createdAt } },
                    {
                      createdAt: newestMessage.createdAt,
                      id: { gt: newestMessage.id },
                    },
                  ],
                },
              ],
            },
          })
        : Promise.resolve(0),
    ]);

    return {
      items: messages.map((message) => ({
        id: message.id,
        sequence: this.encodeCursor(message.createdAt, message.id),
        clientId: null,
        senderId: message.senderId,
        receiverId: message.receiverId,
        encryptedContent: message.encryptedContent,
        encryptionIv: message.encryptionIv,
        encryptionVersion: message.encryptionVersion,
        createdAt: message.createdAt,
        readAt: message.readAt,
        isMe: message.senderId === userId,
      })),
      page: {
        hasOlder: hasOlder > 0,
        hasNewer: hasNewer > 0,
        oldestCursor: oldestMessage
          ? this.encodeCursor(oldestMessage.createdAt, oldestMessage.id)
          : null,
        newestCursor: newestMessage
          ? this.encodeCursor(newestMessage.createdAt, newestMessage.id)
          : null,
      },
    };
  }

  async send(
    userId: string,
    friendId: string,
    clientId: string | undefined,
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
      sequence: this.encodeCursor(message.createdAt, message.id),
      clientId: clientId ?? null,
      senderId: message.senderId,
      receiverId: message.receiverId,
      createdAt: message.createdAt,
      encryptedContent: message.encryptedContent,
      encryptionIv: message.encryptionIv,
      encryptionVersion: message.encryptionVersion,
    });

    return {
      id: message.id,
      sequence: this.encodeCursor(message.createdAt, message.id),
      clientId: clientId ?? null,
      senderId: message.senderId,
      receiverId: message.receiverId,
      encryptedContent: message.encryptedContent,
      encryptionIv: message.encryptionIv,
      encryptionVersion: message.encryptionVersion,
      createdAt: message.createdAt,
      readAt: message.readAt,
      isMe: true,
    };
  }

  async markConversationRead(
    userId: string,
    friendId: string,
    dto: MarkMessagesReadDto,
  ) {
    await this.friendsService.ensureFriends(userId, friendId);

    const cursor = this.decodeCursor(dto.cursor);
    const messageIds = Array.from(new Set(dto.messageIds ?? []));
    const where = {
      senderId: friendId,
      receiverId: userId,
      readAt: null,
      ...(messageIds.length
        ? {
            id: {
              in: messageIds,
            },
          }
        : cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                {
                  createdAt: new Date(cursor.createdAt),
                  id: { lte: cursor.id },
                },
              ],
            }
          : {}),
    };

    const result = await this.prisma.message.updateMany({
      where,
      data: { readAt: new Date() },
    });

    return { success: true, count: result.count };
  }

  private encodeCursor(createdAt: Date, id: string) {
    return Buffer.from(
      JSON.stringify({
        createdAt: createdAt.toISOString(),
        id,
      }),
      'utf8',
    ).toString('base64url');
  }

  private decodeCursor(cursor?: string) {
    if (!cursor) {
      return null;
    }

    try {
      const value = Buffer.from(cursor, 'base64url').toString('utf8');
      const parsed = JSON.parse(value) as MessageCursor;

      if (!parsed.createdAt || !parsed.id) {
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }
}
