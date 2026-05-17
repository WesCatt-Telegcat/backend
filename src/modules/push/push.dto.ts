import { Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';

export class PushSubscriptionKeysDto {
  @IsString()
  @Length(8, 4096)
  p256dh: string;

  @IsString()
  @Length(8, 1024)
  auth: string;
}

export class UpsertPushSubscriptionDto {
  @IsString()
  @Length(16, 4096)
  endpoint: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys: PushSubscriptionKeysDto;

  @IsOptional()
  @IsString()
  @Length(1, 2048)
  userAgent?: string;
}

export class RemovePushSubscriptionDto {
  @IsString()
  @Length(16, 4096)
  endpoint: string;
}
