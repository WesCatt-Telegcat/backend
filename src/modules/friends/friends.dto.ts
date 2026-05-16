import { IsBoolean, IsString, Length, MinLength } from 'class-validator';

export class FriendCodeDto {
  @IsString()
  @Length(4, 40)
  friendCode: string;
}

export class FriendLinkDto {
  @IsString()
  @MinLength(4)
  link: string;
}

export class RespondFriendRequestDto {
  @IsBoolean()
  accept: boolean;
}
