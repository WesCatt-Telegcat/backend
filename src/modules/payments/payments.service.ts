import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createDecipheriv, createSign, createVerify, randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type {
  DonationOrder,
  PaymentOrderStatus,
  PaymentProvider,
} from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentOrderDto } from './payments.dto';

type PaymentMethodStatus = {
  available: boolean;
  reason: string | null;
};

type PaymentHeaders = Record<string, string | string[] | undefined>;

type WeChatCallbackPayload = {
  event_type: string;
  resource: {
    algorithm: string;
    ciphertext: string;
    associated_data?: string;
    nonce: string;
  };
};

type WeChatDecryptedResource = {
  out_trade_no: string;
  transaction_id: string;
  trade_state: string;
};

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  listMethods() {
    return {
      alipay: this.getAlipayStatus(),
      wechat: this.getWeChatStatus(),
    };
  }

  async createOrder(user: AuthUser, dto: CreatePaymentOrderDto) {
    this.ensureProviderConfigured(dto.provider);

    const order = await this.prisma.donationOrder.create({
      data: {
        userId: user.sub,
        provider: dto.provider,
        status: 'PENDING',
        outTradeNo: this.generateOutTradeNo(dto.provider),
        amountFen: dto.amountFen,
        title: dto.title?.trim() || 'Telecat Support',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    const providerResult =
      dto.provider === 'ALIPAY'
        ? await this.createAlipayOrder(order)
        : await this.createWeChatOrder(order);

    const updatedOrder = await this.prisma.donationOrder.update({
      where: { id: order.id },
      data: {
        qrContent: providerResult.qrContent,
        qrContentType: providerResult.qrContentType,
      },
    });

    return this.toOrderResponse(updatedOrder);
  }

  async getOrder(user: AuthUser, orderId: string) {
    const order = await this.prisma.donationOrder.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    if (order.userId && order.userId !== user.sub) {
      throw new ForbiddenException('无权访问该订单');
    }

    return this.toOrderResponse(order);
  }

  async handleAlipayNotify(body: Record<string, unknown>) {
    const params = this.normalizeStringRecord(body);
    const sign = params.sign;

    if (!sign) {
      throw new BadRequestException('缺少支付宝签名');
    }

    const alipayPublicKey = this.readRequiredConfig(
      'ALIPAY_PUBLIC_KEY',
      'ALIPAY_PUBLIC_KEY_PATH',
    );
    const canonical = this.serializeSignParams(params, ['sign', 'sign_type']);
    const verified = createVerify('RSA-SHA256')
      .update(canonical, 'utf8')
      .verify(alipayPublicKey, sign, 'base64');

    if (!verified) {
      throw new BadRequestException('支付宝签名验证失败');
    }

    const outTradeNo = params.out_trade_no;

    if (!outTradeNo) {
      throw new BadRequestException('缺少 out_trade_no');
    }

    const order = await this.prisma.donationOrder.findUnique({
      where: { outTradeNo },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    const nextStatus = this.mapAlipayStatus(params.trade_status);
    if (!nextStatus) {
      return order;
    }

    return this.prisma.donationOrder.update({
      where: { id: order.id },
      data: {
        status: nextStatus,
        providerTradeNo: params.trade_no ?? order.providerTradeNo,
        notifyPayload: JSON.stringify(params),
        paidAt:
          nextStatus === 'PAID' && !order.paidAt ? new Date() : order.paidAt,
      },
    });
  }

  async handleWeChatNotify(rawBody: string, headers: PaymentHeaders) {
    const publicKey = this.readRequiredConfig(
      'WECHAT_PAY_PLATFORM_PUBLIC_KEY',
      'WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH',
    );
    const timestamp = this.readHeader(headers, 'wechatpay-timestamp');
    const nonce = this.readHeader(headers, 'wechatpay-nonce');
    const signature = this.readHeader(headers, 'wechatpay-signature');
    const serial = this.readHeader(headers, 'wechatpay-serial');
    const expectedSerial =
      process.env.WECHAT_PAY_PLATFORM_SERIAL?.trim() || null;

    if (expectedSerial && serial && serial !== expectedSerial) {
      throw new BadRequestException('微信支付平台证书序列号不匹配');
    }

    const verified = createVerify('RSA-SHA256')
      .update(`${timestamp}\n${nonce}\n${rawBody}\n`, 'utf8')
      .verify(publicKey, signature, 'base64');

    if (!verified) {
      throw new BadRequestException('微信支付签名验证失败');
    }

    const payload = JSON.parse(rawBody) as WeChatCallbackPayload;
    const decrypted = this.decryptWeChatResource(payload.resource);
    const order = await this.prisma.donationOrder.findUnique({
      where: { outTradeNo: decrypted.out_trade_no },
    });

    if (!order) {
      throw new NotFoundException('订单不存在');
    }

    const nextStatus = this.mapWeChatStatus(decrypted.trade_state);
    if (!nextStatus) {
      return order;
    }

    return this.prisma.donationOrder.update({
      where: { id: order.id },
      data: {
        status: nextStatus,
        providerTradeNo: decrypted.transaction_id,
        notifyPayload: rawBody,
        paidAt:
          nextStatus === 'PAID' && !order.paidAt ? new Date() : order.paidAt,
      },
    });
  }

  private async createAlipayOrder(order: DonationOrder) {
    const gateway =
      process.env.ALIPAY_GATEWAY ?? 'https://openapi.alipay.com/gateway.do';
    const appId = this.readRequiredEnv('ALIPAY_APP_ID');
    const appPrivateKey = this.readRequiredConfig(
      'ALIPAY_PRIVATE_KEY',
      'ALIPAY_PRIVATE_KEY_PATH',
    );
    const notifyUrl = this.resolveNotifyUrl(
      'ALIPAY_NOTIFY_URL',
      '/payments/notify/alipay',
    );
    const bizContent = {
      out_trade_no: order.outTradeNo,
      total_amount: (order.amountFen / 100).toFixed(2),
      subject: order.title,
      timeout_express: '15m',
    };
    const params = {
      app_id: appId,
      method: 'alipay.trade.precreate',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: this.formatAlipayTimestamp(new Date()),
      version: '1.0',
      notify_url: notifyUrl,
      biz_content: JSON.stringify(bizContent),
    };
    const sign = createSign('RSA-SHA256')
      .update(this.serializeSignParams(params), 'utf8')
      .sign(appPrivateKey, 'base64');
    const body = new URLSearchParams({
      ...params,
      sign,
    });
    const response = await fetch(gateway, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body,
    });
    const payload = (await response.json()) as Record<string, any>;
    const result = payload.alipay_trade_precreate_response;

    if (!response.ok || !result || result.code !== '10000' || !result.qr_code) {
      throw new InternalServerErrorException(
        result?.sub_msg || result?.msg || '支付宝预下单失败',
      );
    }

    return {
      qrContent: result.qr_code as string,
      qrContentType: 'URL',
    };
  }

  private async createWeChatOrder(order: DonationOrder) {
    const appId = this.readRequiredEnv('WECHAT_PAY_APP_ID');
    const mchId = this.readRequiredEnv('WECHAT_PAY_MCH_ID');
    const notifyUrl = this.resolveNotifyUrl(
      'WECHAT_PAY_NOTIFY_URL',
      '/payments/notify/wechat',
    );
    const path = '/v3/pay/transactions/native';
    const body = JSON.stringify({
      appid: appId,
      mchid: mchId,
      description: order.title,
      out_trade_no: order.outTradeNo,
      notify_url: notifyUrl,
      amount: {
        total: order.amountFen,
        currency: 'CNY',
      },
    });
    const response = await fetch(
      `${process.env.WECHAT_PAY_BASE_URL ?? 'https://api.mch.weixin.qq.com'}${path}`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: this.createWeChatAuthorization(path, body),
        },
        body,
      },
    );
    const payload = (await response.json()) as Record<string, any>;

    if (!response.ok || !payload.code_url) {
      throw new InternalServerErrorException(
        String(payload.message || payload.code || '微信支付下单失败'),
      );
    }

    return {
      qrContent: payload.code_url as string,
      qrContentType: 'URL',
    };
  }

  private getAlipayStatus(): PaymentMethodStatus {
    const available = this.hasConfig(['ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY_PATH|ALIPAY_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY_PATH|ALIPAY_PUBLIC_KEY']);

    return {
      available,
      reason: available ? null : '缺少支付宝应用配置',
    };
  }

  private getWeChatStatus(): PaymentMethodStatus {
    const available = this.hasConfig([
      'WECHAT_PAY_APP_ID',
      'WECHAT_PAY_MCH_ID',
      'WECHAT_PAY_SERIAL_NO',
      'WECHAT_PAY_PRIVATE_KEY_PATH|WECHAT_PAY_PRIVATE_KEY',
      'WECHAT_PAY_API_V3_KEY',
      'WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH|WECHAT_PAY_PLATFORM_PUBLIC_KEY',
    ]);

    return {
      available,
      reason: available ? null : '缺少微信支付商户配置',
    };
  }

  private ensureProviderConfigured(provider: PaymentProvider) {
    const status =
      provider === 'ALIPAY' ? this.getAlipayStatus() : this.getWeChatStatus();

    if (!status.available) {
      throw new BadRequestException(status.reason ?? '支付方式未配置');
    }
  }

  private hasConfig(keys: string[]) {
    return keys.every((key) => {
      if (!key.includes('|')) {
        return Boolean(process.env[key]?.trim());
      }

      return key
        .split('|')
        .some((variantKey) => Boolean(process.env[variantKey]?.trim()));
    });
  }

  private resolveNotifyUrl(envKey: string, fallbackPath: string) {
    const explicit = process.env[envKey]?.trim();
    if (explicit) {
      return explicit;
    }

    const backendPublicUrl =
      process.env.BACKEND_PUBLIC_URL?.trim() ?? 'http://localhost:2617';

    return `${backendPublicUrl}${fallbackPath}`;
  }

  private createWeChatAuthorization(path: string, body: string) {
    const mchId = this.readRequiredEnv('WECHAT_PAY_MCH_ID');
    const serialNo = this.readRequiredEnv('WECHAT_PAY_SERIAL_NO');
    const privateKey = this.readRequiredConfig(
      'WECHAT_PAY_PRIVATE_KEY',
      'WECHAT_PAY_PRIVATE_KEY_PATH',
    );
    const nonce = randomBytes(16).toString('hex');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = `POST\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
    const signature = createSign('RSA-SHA256')
      .update(message, 'utf8')
      .sign(privateKey, 'base64');

    return `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`;
  }

  private decryptWeChatResource(resource: WeChatCallbackPayload['resource']) {
    const apiV3Key = this.readRequiredEnv('WECHAT_PAY_API_V3_KEY');
    const ciphertextBuffer = Buffer.from(resource.ciphertext, 'base64');
    const authTag = ciphertextBuffer.subarray(ciphertextBuffer.length - 16);
    const encrypted = ciphertextBuffer.subarray(0, ciphertextBuffer.length - 16);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(apiV3Key, 'utf8'),
      Buffer.from(resource.nonce, 'utf8'),
    );

    if (resource.associated_data) {
      decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
    }
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');

    return JSON.parse(decrypted) as WeChatDecryptedResource;
  }

  private readHeader(headers: PaymentHeaders, name: string) {
    const value = headers[name];
    if (!value) {
      throw new BadRequestException(`缺少请求头 ${name}`);
    }

    return Array.isArray(value) ? value[0] : value;
  }

  private serializeSignParams(
    input: Record<string, string | undefined>,
    ignoredKeys: string[] = [],
  ) {
    return Object.keys(input)
      .filter((key) => !ignoredKeys.includes(key) && input[key] !== undefined && input[key] !== '')
      .sort()
      .map((key) => `${key}=${input[key]}`)
      .join('&');
  }

  private normalizeStringRecord(body: Record<string, unknown>) {
    const entries = Object.entries(body).map(([key, value]) => [
      key,
      Array.isArray(value) ? String(value[0] ?? '') : String(value ?? ''),
    ]);

    return Object.fromEntries(entries) as Record<string, string>;
  }

  private mapAlipayStatus(status?: string): PaymentOrderStatus | null {
    if (status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED') {
      return 'PAID';
    }

    if (status === 'TRADE_CLOSED') {
      return 'CLOSED';
    }

    return null;
  }

  private mapWeChatStatus(status?: string): PaymentOrderStatus | null {
    if (status === 'SUCCESS') {
      return 'PAID';
    }

    if (status === 'CLOSED') {
      return 'CLOSED';
    }

    if (status === 'PAYERROR') {
      return 'FAILED';
    }

    return null;
  }

  private generateOutTradeNo(provider: PaymentProvider) {
    const prefix = provider === 'ALIPAY' ? 'AL' : 'WC';
    const randomPart = randomBytes(4).toString('hex').toUpperCase();

    return `TC${prefix}${Date.now()}${randomPart}`.slice(0, 32);
  }

  private formatAlipayTimestamp(date: Date) {
    const pad = (value: number) => String(value).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate(),
    )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private readRequiredEnv(key: string) {
    const value = process.env[key]?.trim();

    if (!value) {
      throw new InternalServerErrorException(`缺少环境变量 ${key}`);
    }

    return value;
  }

  private readRequiredConfig(valueKey: string, pathKey: string) {
    const inlineValue = process.env[valueKey]?.trim();

    if (inlineValue) {
      return inlineValue.includes('BEGIN') ? inlineValue : inlineValue.replace(/\\n/g, '\n');
    }

    const configPath = process.env[pathKey]?.trim();
    if (!configPath) {
      throw new InternalServerErrorException(
        `缺少环境变量 ${valueKey} 或 ${pathKey}`,
      );
    }

    const absolutePath = resolve(process.cwd(), configPath);
    if (!existsSync(absolutePath)) {
      throw new InternalServerErrorException(`配置文件不存在: ${absolutePath}`);
    }

    return readFileSync(absolutePath, 'utf8');
  }

  private toOrderResponse(order: DonationOrder) {
    return {
      id: order.id,
      provider: order.provider,
      status: order.status,
      amountFen: order.amountFen,
      outTradeNo: order.outTradeNo,
      qrContent: order.qrContent,
      qrContentType: order.qrContentType,
      expiresAt: order.expiresAt,
      paidAt: order.paidAt,
      createdAt: order.createdAt,
    };
  }
}
