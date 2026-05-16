import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../auth/auth.types';
import { SendMessageDto } from './messages.dto';
import { MessagesService } from './messages.service';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get(':friendId')
  list(@CurrentUser() user: AuthUser, @Param('friendId') friendId: string) {
    return this.messagesService.listConversation(user.sub, friendId);
  }

  @Post(':friendId')
  send(
    @CurrentUser() user: AuthUser,
    @Param('friendId') friendId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messagesService.send(
      user.sub,
      friendId,
      dto.encryptedContent,
      dto.encryptionIv,
    );
  }
}
