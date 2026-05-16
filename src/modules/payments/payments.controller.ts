import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CurrentUser,
  SkipLogin,
  SkipResponseFormat,
} from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../auth/auth.types';
import { CreatePaymentOrderDto } from './payments.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('methods')
  methods() {
    return this.paymentsService.listMethods();
  }

  @Post('orders')
  createOrder(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentOrderDto) {
    return this.paymentsService.createOrder(user, dto);
  }

  @Get('orders/:orderId')
  getOrder(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.paymentsService.getOrder(user, orderId);
  }

  @SkipLogin()
  @SkipResponseFormat()
  @Post('notify/alipay')
  async alipayNotify(
    @Body() body: Record<string, unknown>,
    @Res() response: Response,
  ) {
    try {
      await this.paymentsService.handleAlipayNotify(body);
      response.type('text/plain').send('success');
    } catch {
      response.status(400).type('text/plain').send('failure');
    }
  }

  @SkipLogin()
  @SkipResponseFormat()
  @Post('notify/wechat')
  async wechatNotify(
    @Req() request: Request & { rawBody?: Buffer },
    @Res() response: Response,
  ) {
    try {
      const rawBody = request.rawBody?.toString('utf8') ?? '';
      await this.paymentsService.handleWeChatNotify(rawBody, request.headers);
      response.status(200).json({
        code: 'SUCCESS',
        message: '成功',
      });
    } catch {
      response.status(400).json({
        code: 'FAIL',
        message: '失败',
      });
    }
  }
}
