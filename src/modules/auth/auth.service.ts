import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomInt, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { JwtService } from './jwt.service';
import { PasswordService } from './password.service';
import { AuthUser, SafeUser } from './auth.types';
import {
  LoginDto,
  RegisterDto,
  SendCodeDto,
  UpdateEncryptionKeyDto,
} from './auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly passwordService: PasswordService,
    private readonly mailService: MailService,
  ) {}

  async sendRegisterCode(dto: SendCodeDto) {
    const email = this.normalizeEmail(dto.email);
    const existingUser = await this.prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      throw new ConflictException('该邮箱已注册');
    }

    const code = randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.prisma.verificationCode.updateMany({
      where: {
        email,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });

    await this.prisma.verificationCode.create({
      data: { email, code, expiresAt },
    });

    await this.mailService.sendVerificationCode(email, code);

    return {
      email,
      expiresIn: 15 * 60,
      resendIn: 60,
    };
  }

  async register(dto: RegisterDto) {
    const email = this.normalizeEmail(dto.email);
    const existingUser = await this.prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      throw new ConflictException('该邮箱已注册');
    }

    const code = await this.prisma.verificationCode.findFirst({
      where: {
        email,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!code || code.code !== dto.code) {
      throw new BadRequestException('验证码无效或已过期');
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        passwordHash: this.passwordService.hash(dto.password),
        friendCode: await this.createFriendCode(),
        encryptionPublicKey: dto.encryptionPublicKey,
        encryptedPrivateKey: dto.encryptedPrivateKey,
        encryptionKeySalt: dto.encryptionKeySalt,
        encryptionKeyIv: dto.encryptionKeyIv,
        encryptionKeyVersion: dto.encryptionKeyVersion ?? 'v1',
      },
    });

    await this.prisma.verificationCode.update({
      where: { id: code.id },
      data: { usedAt: new Date() },
    });

    return this.createAuthResponse(user);
  }

  async login(dto: LoginDto) {
    const email = this.normalizeEmail(dto.email);
    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !this.passwordService.verify(dto.password, user.passwordHash)) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    if (this.shouldUpdateEncryptionPackage(user, dto)) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: this.buildEncryptionPackageData(dto),
      });
    }

    return this.createAuthResponse(user);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return this.toSafeUser(user);
  }

  async updateEncryptionKey(userId: string, dto: UpdateEncryptionKeyDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    const updatedUser =
      this.shouldUpdateEncryptionPackage(user, dto)
        ? await this.prisma.user.update({
            where: { id: userId },
            data: this.buildEncryptionPackageData(dto),
          })
        : user;

    return this.toSafeUser(updatedUser);
  }

  private createAuthResponse(user: {
    id: string;
    email: string;
    name: string;
    friendCode: string;
    avatar: string | null;
    encryptionPublicKey: string | null;
    encryptedPrivateKey: string | null;
    encryptionKeySalt: string | null;
    encryptionKeyIv: string | null;
    encryptionKeyVersion: string | null;
  }) {
    const payload: AuthUser = {
      sub: user.id,
      email: user.email,
      name: user.name,
      friendCode: user.friendCode,
    };

    return {
      token: this.jwtService.sign(payload),
      user: this.toSafeUser(user),
    };
  }

  private toSafeUser(user: {
    id: string;
    email: string;
    name: string;
    friendCode: string;
    avatar: string | null;
    encryptionPublicKey: string | null;
    encryptedPrivateKey: string | null;
    encryptionKeySalt: string | null;
    encryptionKeyIv: string | null;
    encryptionKeyVersion: string | null;
  }): SafeUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      friendCode: user.friendCode,
      friendLink: `${process.env.FRONTEND_URL ?? 'http://localhost:2616'}?friend=${user.friendCode}`,
      avatar: user.avatar,
      encryptionPublicKey: user.encryptionPublicKey,
      encryptedPrivateKey: user.encryptedPrivateKey,
      encryptionKeySalt: user.encryptionKeySalt,
      encryptionKeyIv: user.encryptionKeyIv,
      encryptionKeyVersion: user.encryptionKeyVersion,
    };
  }

  private shouldUpdateEncryptionPackage(
    user: {
      encryptionPublicKey: string | null;
      encryptedPrivateKey: string | null;
      encryptionKeySalt: string | null;
      encryptionKeyIv: string | null;
      encryptionKeyVersion: string | null;
    },
    dto: UpdateEncryptionKeyDto | LoginDto,
  ) {
    if (!dto.encryptionPublicKey) {
      return false;
    }

    return (
      dto.encryptionPublicKey !== user.encryptionPublicKey ||
      (dto.encryptedPrivateKey ?? null) !== user.encryptedPrivateKey ||
      (dto.encryptionKeySalt ?? null) !== user.encryptionKeySalt ||
      (dto.encryptionKeyIv ?? null) !== user.encryptionKeyIv ||
      (dto.encryptionKeyVersion ?? 'v1') !== (user.encryptionKeyVersion ?? 'v1')
    );
  }

  private buildEncryptionPackageData(
    dto: UpdateEncryptionKeyDto | LoginDto,
  ): {
    encryptionPublicKey: string;
    encryptedPrivateKey: string | null;
    encryptionKeySalt: string | null;
    encryptionKeyIv: string | null;
    encryptionKeyVersion: string;
  } {
    return {
      encryptionPublicKey: dto.encryptionPublicKey as string,
      encryptedPrivateKey: dto.encryptedPrivateKey ?? null,
      encryptionKeySalt: dto.encryptionKeySalt ?? null,
      encryptionKeyIv: dto.encryptionKeyIv ?? null,
      encryptionKeyVersion: dto.encryptionKeyVersion ?? 'v1',
    };
  }

  private async createFriendCode() {
    for (let i = 0; i < 8; i += 1) {
      const code = `TC${randomBytes(4).toString('hex').toUpperCase()}`;
      const existing = await this.prisma.user.findUnique({
        where: { friendCode: code },
      });

      if (!existing) {
        return code;
      }
    }

    throw new BadRequestException('生成好友 ID 失败，请重试');
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }
}
