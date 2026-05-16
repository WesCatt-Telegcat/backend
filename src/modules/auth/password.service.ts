import { Injectable } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

@Injectable()
export class PasswordService {
  hash(password: string) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');

    return `${salt}:${hash}`;
  }

  verify(password: string, passwordHash: string) {
    const [salt, hash] = passwordHash.split(':');
    if (!salt || !hash) {
      return false;
    }

    const actual = Buffer.from(scryptSync(password, salt, 64).toString('hex'));
    const expected = Buffer.from(hash);

    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
