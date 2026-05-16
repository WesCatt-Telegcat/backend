//过滤器

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

//捕捉错误，返回格式化错误信息
@Catch(Error)
export class FormatMessageFilter implements ExceptionFilter {
  private readonly logger = new Logger();

  async catch(exception: Error, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    let status = 500;
    let res: { message: string[] | string } = { message: '' };

    // 如果是http 错误
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      res = exception.getResponse() as { message: string[] };
    }

    const message = res.message;

    // 如果是不存在资源的错误
    if (exception instanceof NotFoundException) {
      response.status(404).send('Not Found');
    } else {
      // 其他错误返回对应的信息
      response.status(status).json({
        code: status,
        ...(typeof res.message === 'object'
          ? { message: res.message[0], data: res.message }
          : { message }),
      });
    }

    // 如果不是 HttpException，则记录错误日志
    if (!(exception instanceof HttpException)) {
      this.logger.error(exception);
    }
  }
}
