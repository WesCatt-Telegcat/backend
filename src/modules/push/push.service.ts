import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertPushSubscriptionDto } from './push.dto';

type WebPushError = Error & {
  statusCode?: number;
};

function readPushConfig() {
  const subject =
    process.env.WEB_PUSH_SUBJECT ??
    process.env.WEB_PUSH_VAPID_SUBJECT ??
    '';
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? '';
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY ?? '';

  return {
    subject: subject.trim(),
    publicKey: publicKey.trim(),
    privateKey: privateKey.trim(),
  };
}

@Injectable()
export class PushService {
  private readonly config = readPushConfig();

  constructor(private readonly prisma: PrismaService) {
    if (this.isConfigured()) {
      webpush.setVapidDetails(
        this.config.subject,
        this.config.publicKey,
        this.config.privateKey,
      );
    }
  }

  getClientConfig() {
    return {
      available: this.isConfigured(),
      vapidPublicKey: this.isConfigured() ? this.config.publicKey : null,
    };
  }

  async upsertSubscription(
    userId: string,
    dto: UpsertPushSubscriptionDto,
  ) {
    const endpointHash = this.hashEndpoint(dto.endpoint);
    const lastUsedAt = new Date();

    await this.pushSubscriptionDelegate().upsert({
      where: { endpointHash },
      update: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent: dto.userAgent ?? null,
        lastUsedAt,
      },
      create: {
        userId,
        endpointHash,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent: dto.userAgent ?? null,
        lastUsedAt,
      },
    });

    return { success: true };
  }

  async removeSubscription(userId: string, endpoint: string) {
    const endpointHash = this.hashEndpoint(endpoint);

    await this.pushSubscriptionDelegate().deleteMany({
      where: {
        userId,
        endpointHash,
      },
    });

    return { success: true };
  }

  async sendNewMessageNotification(input: {
    recipientUserId: string;
    senderId: string;
    senderName: string;
  }) {
    if (!this.isConfigured()) {
      return;
    }

    const subscriptions = await this.pushSubscriptionDelegate().findMany({
      where: {
        userId: input.recipientUserId,
      },
      select: {
        id: true,
        endpoint: true,
        p256dh: true,
        auth: true,
      },
    });

    if (subscriptions.length === 0) {
      return;
    }

    const payload = JSON.stringify({
      title: input.senderName,
      body: '你收到一条新消息',
      tag: `chat-${input.senderId}`,
      icon: '/pwa-icon-192',
      badge: '/pwa-icon-192',
      data: {
        url: `/?chat=${input.senderId}`,
      },
    });

    await Promise.allSettled(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            payload,
            {
              TTL: 60,
            },
          );
        } catch (error) {
          const webPushError = error as WebPushError;

          if (
            webPushError.statusCode === 404 ||
            webPushError.statusCode === 410
          ) {
            await this.pushSubscriptionDelegate().delete({
              where: { id: subscription.id },
            });
          }
        }
      }),
    );
  }

  private isConfigured() {
    return Boolean(
      this.config.subject &&
        this.config.publicKey &&
        this.config.privateKey,
    );
  }

  private hashEndpoint(endpoint: string) {
    return createHash('sha256').update(endpoint).digest('hex');
  }

  private pushSubscriptionDelegate() {
    return (this.prisma as unknown as {
      pushSubscription: {
        upsert: (...args: unknown[]) => Promise<unknown>;
        deleteMany: (...args: unknown[]) => Promise<unknown>;
        findMany: (...args: unknown[]) => Promise<
          Array<{
            id: string;
            endpoint: string;
            p256dh: string;
            auth: string;
          }>
        >;
        delete: (...args: unknown[]) => Promise<unknown>;
      };
    }).pushSubscription;
  }
}
