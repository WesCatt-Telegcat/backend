import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { AuthUser } from './auth.types';

type JwtPayload = AuthUser & {
  iat: number;
  exp: number;
};

@Injectable()
export class JwtService {
  private readonly secret =
    process.env.JWT_SECRET ?? 'telecat-dev-secret-change-me';

  sign(payload: AuthUser, expiresInSeconds = 60 * 60 * 24 * 7) {
    const now = Math.floor(Date.now() / 1000);
    const header = this.encode({ alg: 'HS256', typ: 'JWT' });
    const body = this.encode({
      ...payload,
      iat: now,
      exp: now + expiresInSeconds,
    });
    const signature = this.signPart(`${header}.${body}`);

    return `${header}.${body}.${signature}`;
  }

  verify(token: string): JwtPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Invalid token');
    }

    const [header, body, signature] = parts;
    const expected = this.signPart(`${header}.${body}`);

    if (!this.safeEqual(signature, expected)) {
      throw new UnauthorizedException('Invalid token');
    }

    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as JwtPayload;

    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Token expired');
    }

    return payload;
  }

  private encode(value: unknown) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private signPart(value: string) {
    return createHmac('sha256', this.secret).update(value).digest('base64url');
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }
}
