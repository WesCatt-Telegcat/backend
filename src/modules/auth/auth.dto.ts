import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';

class EncryptionKeyPayloadDto {
  @IsOptional()
  @IsString()
  @Length(20, 5000)
  encryptionPublicKey?: string;

  @IsOptional()
  @IsString()
  @Length(20, 20000)
  encryptedPrivateKey?: string;

  @IsOptional()
  @IsString()
  @Length(8, 512)
  encryptionKeySalt?: string;

  @IsOptional()
  @IsString()
  @Length(8, 512)
  encryptionKeyIv?: string;

  @IsOptional()
  @IsString()
  @Length(2, 32)
  encryptionKeyVersion?: string;
}

export class SendCodeDto {
  @IsEmail()
  email: string;
}

export class RegisterDto extends EncryptionKeyPayloadDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(2, 30)
  name: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @Length(6, 6)
  code: string;
}

export class LoginDto extends EncryptionKeyPayloadDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}

export class UpdateEncryptionKeyDto extends EncryptionKeyPayloadDto {}
