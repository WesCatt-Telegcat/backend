import { Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer';
import { MailService } from './mail.service';

@Module({
  imports: [
    MailerModule.forRoot({
      transport: {
        host: process.env.MAIL_HOST,
        port: Number(process.env.MAIL_PORT ?? 465),
        secure: process.env.MAIL_SECURE !== 'false',
        auth: {
          user: process.env.MAIL_USER,
          pass: process.env.MAIL_PASS,
        },
      },
      defaults: {
        from:
          process.env.MAIL_FROM ??
          (process.env.MAIL_USER ? `Telecat <${process.env.MAIL_USER}>` : ''),
      },
    }),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
