import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser, SkipLogin } from '../../common/decorators/auth.decorators';
import type { AuthUser } from './auth.types';
import { AuthService } from './auth.service';
import {
  LoginDto,
  RegisterDto,
  SendCodeDto,
  UpdateEncryptionKeyDto,
} from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @SkipLogin()
  @Post('send-code')
  sendCode(@Body() dto: SendCodeDto) {
    return this.authService.sendRegisterCode(dto);
  }

  @SkipLogin()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @SkipLogin()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user.sub);
  }

  @Post('me/encryption-key')
  updateEncryptionKey(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateEncryptionKeyDto,
  ) {
    return this.authService.updateEncryptionKey(user.sub, dto);
  }
}
