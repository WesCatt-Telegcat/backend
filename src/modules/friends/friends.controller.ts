import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../auth/auth.types';
import {
  FriendCodeDto,
  FriendLinkDto,
  RespondFriendRequestDto,
} from './friends.dto';
import { FriendsService } from './friends.service';

@Controller('friends')
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.friendsService.listFriends(user.sub);
  }

  @Get('search/:friendCode')
  search(@CurrentUser() user: AuthUser, @Param('friendCode') friendCode: string) {
    return this.friendsService.searchByCode(user.sub, friendCode);
  }

  @Post('requests')
  request(@CurrentUser() user: AuthUser, @Body() dto: FriendCodeDto) {
    return this.friendsService.sendRequest(user.sub, dto.friendCode);
  }

  @Post('link')
  addByLink(@CurrentUser() user: AuthUser, @Body() dto: FriendLinkDto) {
    return this.friendsService.addByLink(user.sub, dto.link);
  }

  @Get('requests/incoming')
  incoming(@CurrentUser() user: AuthUser) {
    return this.friendsService.listIncomingRequests(user.sub);
  }

  @Post('requests/:id/respond')
  respond(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RespondFriendRequestDto,
  ) {
    return this.friendsService.respondRequest(user.sub, id, dto.accept);
  }
}
