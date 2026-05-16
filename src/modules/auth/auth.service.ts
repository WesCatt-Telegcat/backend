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
import { LoginDto, RegisterDto, SendCodeDto } from './auth.dto';

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

    if (
      dto.encryptionPublicKey &&
      dto.encryptionPublicKey !== user.encryptionPublicKey
    ) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { encryptionPublicKey: dto.encryptionPublicKey },
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

  private createAuthResponse(user: {
    id: string;
    email: string;
    name: string;
    friendCode: string;
    avatar: string | null;
    encryptionPublicKey: string | null;
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
  }): SafeUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      friendCode: user.friendCode,
      friendLink: `${process.env.FRONTEND_URL ?? 'http://localhost:2616'}?friend=${user.friendCode}`,
      avatar: user.avatar,
      encryptionPublicKey: user.encryptionPublicKey,
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
