import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { AuthUser } from '../../modules/auth/auth.types';

// 跳过登录，无需token
export const SkipLogin = () => {
  return applyDecorators(SetMetadata('skip-login', true));
};

export const SkipResponseFormat = () => {
  return applyDecorators(SetMetadata('skip-response-format', true));
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();

    return request.user;
  },
);
