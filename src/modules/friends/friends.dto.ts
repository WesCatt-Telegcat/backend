import { IsBoolean, IsString, Length, MinLength } from 'class-validator';

export class FriendCodeDto {
  @IsString({ message: '唯一 ID 格式不正确' })
  @Length(4, 40, { message: '唯一 ID 长度必须在 4 到 40 个字符之间' })
  friendCode: string;
}

export class FriendLinkDto {
  @IsString({ message: '好友链接格式不正确' })
  @MinLength(4, { message: '好友链接无效' })
  link: string;
}

export class RespondFriendRequestDto {
  @IsBoolean({ message: '好友申请处理参数无效' })
  accept: boolean;
}
