import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { AuthGuard } from './common/guards/auth.guard';
import { FormatMessageFilter } from './common/filters/format-message.filter';
import { FormatMessageInterceptor } from './common/interceptors/format-message.interceptor';
import { FriendsModule } from './modules/friends/friends.module';
import { MessagesModule } from './modules/messages/messages.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { PushModule } from './modules/push/push.module';
import { RealtimeModule } from './modules/realtime/realtime.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    RealtimeModule,
    PushModule,
    FriendsModule,
    MessagesModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: FormatMessageInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: FormatMessageFilter,
    },
  ],
})
export class AppModule {}
