import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { SkipLogin } from './common/decorators/auth.decorators';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @SkipLogin()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
