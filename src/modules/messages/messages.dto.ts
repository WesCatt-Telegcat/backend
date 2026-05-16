import { IsString, Length } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @Length(1, 20000)
  encryptedContent: string;

  @IsString()
  @Length(8, 256)
  encryptionIv: string;
}
