import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';
import { Response } from 'express';

// 异常拦截器，在这里对返回信息做格式化处理，不包括错误信息
@Injectable()
export class FormatMessageInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<any>,
  ): Observable<any> | Promise<Observable<any>> {
    const response: Response = context.switchToHttp().getResponse();
    const skipResponseFormat = this.reflector.getAllAndOverride<boolean>(
      'skip-response-format',
      [context.getHandler(), context.getClass()],
    );

    if (skipResponseFormat) {
      return next.handle();
    }

    if (response.statusCode === 201) {
      response.statusCode = 200;
    }
    return next.handle().pipe(
      map((data) => {
        return {
          code: response.statusCode,
          message: 'success',
          data,
        };
      }),
    );
  }
}
