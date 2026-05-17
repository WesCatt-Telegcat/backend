import { Module } from '@nestjs/common';
import { FriendsModule } from '../friends/friends.module';
import { PushModule } from '../push/push.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [FriendsModule, RealtimeModule, PushModule],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
