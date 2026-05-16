import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async listFriends(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      include: {
        userA: true,
        userB: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      friendships.map(async (friendship) => {
        const friend =
          friendship.userAId === userId ? friendship.userB : friendship.userA;
        const lastMessage = await this.prisma.message.findFirst({
          where: {
            OR: [
              { senderId: userId, receiverId: friend.id },
              { senderId: friend.id, receiverId: userId },
            ],
          },
          orderBy: { createdAt: 'desc' },
        });
        const unread = await this.prisma.message.count({
          where: {
            senderId: friend.id,
            receiverId: userId,
            readAt: null,
          },
        });

        return {
          id: friend.id,
          name: friend.name,
          email: friend.email,
          avatar: friend.avatar,
          friendCode: friend.friendCode,
          encryptionPublicKey: friend.encryptionPublicKey,
          online: this.realtimeService.isOnline(friend.id),
          lastMessage: lastMessage ? '' : '还没有消息',
          lastMessageEncryptedContent: lastMessage?.encryptedContent ?? null,
          lastMessageEncryptionIv: lastMessage?.encryptionIv ?? null,
          lastMessageEncryptionVersion: lastMessage?.encryptionVersion ?? null,
          lastMessageSenderId: lastMessage?.senderId ?? null,
          lastMessageAt: lastMessage?.createdAt ?? friendship.createdAt,
          unread,
        };
      }),
    );
  }

  async searchByCode(userId: string, rawCode: string) {
    const friendCode = this.normalizeFriendCode(rawCode);
    const user = await this.prisma.user.findUnique({ where: { friendCode } });

    if (!user) {
      throw new NotFoundException('没有找到该用户');
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      friendCode: user.friendCode,
      encryptionPublicKey: user.encryptionPublicKey,
      relation: await this.getRelationStatus(userId, user.id),
    };
  }

  async sendRequest(userId: string, rawCode: string) {
    const target = await this.getTargetByCode(userId, rawCode);

    if (await this.areFriends(userId, target.id)) {
      throw new ConflictException('你们已经是好友');
    }

    const reverseRequest = await this.prisma.friendRequest.findUnique({
      where: {
        requesterId_addresseeId: {
          requesterId: target.id,
          addresseeId: userId,
        },
      },
    });

    if (reverseRequest?.status === 'PENDING') {
      await this.createFriendship(userId, target.id);
      await this.prisma.friendRequest.update({
        where: { id: reverseRequest.id },
        data: { status: 'ACCEPTED' },
      });
      this.realtimeService.emitFriendsChanged([userId, target.id]);

      return { status: 'ACCEPTED' };
    }

    const outgoingRequest = await this.prisma.friendRequest.findUnique({
      where: {
        requesterId_addresseeId: {
          requesterId: userId,
          addresseeId: target.id,
        },
      },
    });

    if (outgoingRequest?.status === 'PENDING') {
      throw new ConflictException('好友申请已发送，请等待对方处理');
    }

    const request = await this.prisma.friendRequest.upsert({
      where: {
        requesterId_addresseeId: {
          requesterId: userId,
          addresseeId: target.id,
        },
      },
      update: { status: 'PENDING' },
      create: {
        requesterId: userId,
        addresseeId: target.id,
      },
      include: { requester: true, addressee: true },
    });

    this.realtimeService.emitFriendRequest(target.id, {
      id: request.id,
      createdAt: request.createdAt,
      requester: {
        id: request.requester.id,
        name: request.requester.name,
        email: request.requester.email,
        avatar: request.requester.avatar,
        friendCode: request.requester.friendCode,
      },
    });

    return {
      id: request.id,
      status: request.status,
      user: {
        id: request.addressee.id,
        name: request.addressee.name,
        email: request.addressee.email,
        avatar: request.addressee.avatar,
        friendCode: request.addressee.friendCode,
        encryptionPublicKey: request.addressee.encryptionPublicKey,
      },
    };
  }

  async addByLink(userId: string, link: string) {
    const friendCode = this.extractFriendCode(link);
    const target = await this.getTargetByCode(userId, friendCode);

    await this.createFriendship(userId, target.id);
    await this.prisma.friendRequest.updateMany({
      where: {
        OR: [
          { requesterId: userId, addresseeId: target.id },
          { requesterId: target.id, addresseeId: userId },
        ],
      },
      data: { status: 'ACCEPTED' },
    });
    this.realtimeService.emitFriendsChanged([userId, target.id]);

    return {
      id: target.id,
      name: target.name,
      email: target.email,
      avatar: target.avatar,
      friendCode: target.friendCode,
      encryptionPublicKey: target.encryptionPublicKey,
    };
  }

  async listIncomingRequests(userId: string) {
    const requests = await this.prisma.friendRequest.findMany({
      where: { addresseeId: userId, status: 'PENDING' },
      include: { requester: true },
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((request) => ({
      id: request.id,
      createdAt: request.createdAt,
      requester: {
        id: request.requester.id,
        name: request.requester.name,
        email: request.requester.email,
        avatar: request.requester.avatar,
        friendCode: request.requester.friendCode,
        encryptionPublicKey: request.requester.encryptionPublicKey,
      },
    }));
  }

  async respondRequest(userId: string, requestId: string, accept: boolean) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
      include: { requester: true },
    });

    if (!request) {
      throw new NotFoundException('好友申请不存在');
    }

    if (request.addresseeId !== userId) {
      throw new ForbiddenException('不能处理别人的好友申请');
    }

    if (request.status !== 'PENDING') {
      throw new ConflictException('该申请已处理');
    }

    await this.prisma.friendRequest.update({
      where: { id: request.id },
      data: { status: accept ? 'ACCEPTED' : 'REJECTED' },
    });

    if (accept) {
      await this.createFriendship(userId, request.requesterId);
    }

    this.realtimeService.emitFriendsChanged([userId, request.requesterId]);

    return { status: accept ? 'ACCEPTED' : 'REJECTED' };
  }

  async ensureFriends(userId: string, friendId: string) {
    if (!(await this.areFriends(userId, friendId))) {
      throw new ForbiddenException('只能给好友发送消息');
    }
  }

  private async getTargetByCode(userId: string, rawCode: string) {
    const friendCode = this.normalizeFriendCode(rawCode);
    const target = await this.prisma.user.findUnique({ where: { friendCode } });

    if (!target) {
      throw new NotFoundException('没有找到该用户');
    }

    if (target.id === userId) {
      throw new BadRequestException('不能添加自己为好友');
    }

    return target;
  }

  private async getRelationStatus(userId: string, targetId: string) {
    if (userId === targetId) {
      return 'SELF';
    }

    if (await this.areFriends(userId, targetId)) {
      return 'FRIEND';
    }

    const outgoing = await this.prisma.friendRequest.findUnique({
      where: {
        requesterId_addresseeId: {
          requesterId: userId,
          addresseeId: targetId,
        },
      },
    });

    if (outgoing?.status === 'PENDING') {
      return 'REQUESTED';
    }

    const incoming = await this.prisma.friendRequest.findUnique({
      where: {
        requesterId_addresseeId: {
          requesterId: targetId,
          addresseeId: userId,
        },
      },
    });

    return incoming?.status === 'PENDING' ? 'NEED_ACCEPT' : 'NONE';
  }

  private async areFriends(userId: string, friendId: string) {
    const pair = this.friendshipPair(userId, friendId);
    const friendship = await this.prisma.friendship.findUnique({
      where: { userAId_userBId: pair },
    });

    return Boolean(friendship);
  }

  private async createFriendship(userId: string, friendId: string) {
    const pair = this.friendshipPair(userId, friendId);

    return this.prisma.friendship.upsert({
      where: { userAId_userBId: pair },
      update: {},
      create: pair,
    });
  }

  private friendshipPair(userId: string, friendId: string) {
    const [userAId, userBId] = [userId, friendId].sort();

    return { userAId, userBId };
  }

  private extractFriendCode(value: string) {
    const input = value.trim();

    try {
      const url = new URL(input);
      return this.normalizeFriendCode(
        url.searchParams.get('friend') ??
          url.searchParams.get('code') ??
          url.pathname.split('/').filter(Boolean).at(-1) ??
          input,
      );
    } catch {
      return this.normalizeFriendCode(input);
    }
  }

  private normalizeFriendCode(value: string) {
    return value.trim().toUpperCase();
  }
}
