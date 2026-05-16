import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @Length(1, 20000)
  encryptedContent: string;

  @IsString()
  @Length(8, 256)
  encryptionIv: string;
}

export class ListMessagesQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsIn(['older', 'newer'])
  direction?: 'older' | 'newer';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
