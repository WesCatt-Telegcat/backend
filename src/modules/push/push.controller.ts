import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../auth/auth.types';
import {
  RemovePushSubscriptionDto,
  UpsertPushSubscriptionDto,
} from './push.dto';
import { PushService } from './push.service';

@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get('config')
  getConfig() {
    return this.pushService.getClientConfig();
  }

  @Post('subscriptions')
  upsertSubscription(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertPushSubscriptionDto,
  ) {
    return this.pushService.upsertSubscription(user.sub, dto);
  }

  @Delete('subscriptions')
  removeSubscription(
    @CurrentUser() user: AuthUser,
    @Body() dto: RemovePushSubscriptionDto,
  ) {
    return this.pushService.removeSubscription(user.sub, dto.endpoint);
  }
}
