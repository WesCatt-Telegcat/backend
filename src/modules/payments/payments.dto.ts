import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreatePaymentOrderDto {
  @IsIn(['ALIPAY', 'WECHAT'])
  provider: 'ALIPAY' | 'WECHAT';

  @IsInt()
  @Min(100)
  amountFen: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  title?: string;
}
