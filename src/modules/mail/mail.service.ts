import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) {}

  async sendVerificationCode(email: string, code: string) {
    this.ensureConfigured();
    const logoAttachment = this.getLogoAttachment();

    await this.mailerService.sendMail({
      to: email,
      subject: '你的 Telecat 注册验证码',
      text: [
        'Telecat 注册验证码',
        '',
        `你的验证码是：${code}`,
        '',
        '此验证码用于注册 Telecat 账号，15 分钟内有效。',
        '如果你没有发起本次请求，请忽略这封邮件。请不要把验证码透露给任何人。',
      ].join('\n'),
      html: this.renderVerificationCodeEmail(code, Boolean(logoAttachment)),
      attachments: logoAttachment ? [logoAttachment] : [],
    });
  }

  private renderVerificationCodeEmail(code: string, hasLogo: boolean) {
    return `
      <!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Telecat 注册验证码</title>
        </head>
        <body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#111827;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f9;padding:32px 16px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;">
                  <tr>
                    <td style="padding:30px 32px 18px;text-align:center;">
                      ${
                        hasLogo
                          ? '<img src="cid:telecat-logo" alt="Telecat" width="48" height="48" style="display:block;margin:0 auto 14px;border:0;outline:none;text-decoration:none;" />'
                          : ''
                      }
                      <div style="font-size:22px;font-weight:800;letter-spacing:0.02em;color:#111827;">Telecat</div>
                      <div style="margin-top:8px;font-size:14px;color:#6b7280;">注册验证码</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 32px 8px;text-align:center;">
                      <p style="margin:0;font-size:15px;line-height:1.7;color:#374151;">
                        这是用于注册 Telecat 账号的验证码。
                      </p>
                      <p style="margin:6px 0 0;font-size:15px;line-height:1.7;color:#374151;">
                        请在页面中输入以下验证码完成验证：
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding:22px 32px;">
                      <div style="display:inline-block;min-width:220px;border-radius:16px;background:#111827;color:#ffffff;padding:18px 28px;font-size:36px;font-weight:800;letter-spacing:10px;line-height:1;">
                        ${code}
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 32px 26px;text-align:center;">
                      <p style="margin:0;font-size:14px;line-height:1.7;color:#6b7280;">
                        验证码将在 <strong style="color:#111827;">15 分钟</strong> 后失效。请勿将验证码透露给任何人。
                      </p>
                      <p style="margin:10px 0 0;font-size:13px;line-height:1.7;color:#9ca3af;">
                        如果你没有发起本次注册请求，请忽略这封邮件。
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="border-top:1px solid #eef0f3;padding:18px 32px;text-align:center;background:#fbfbfc;">
                      <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">
                        这是一封来自 Telecat 的自动邮件，请不要直接回复。
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;
  }

  private getLogoAttachment() {
    const logoPath = this.getLogoPath();

    if (!logoPath) {
      return null;
    }

    if (logoPath.endsWith('.svg')) {
      const svg = readFileSync(logoPath, 'utf8');
      const embeddedPng = svg.match(
        /(?:xlink:)?href=["']data:(?:image|img)\/png;base64,([^"']+)["']/i,
      );

      if (embeddedPng?.[1]) {
        return {
          filename: 'telecat-logo.png',
          content: Buffer.from(embeddedPng[1], 'base64'),
          contentType: 'image/png',
          contentDisposition: 'inline' as const,
          cid: 'telecat-logo',
        };
      }
    }

    return {
      filename: 'telecat-logo.svg',
      path: logoPath,
      contentType: 'image/svg+xml',
      contentDisposition: 'inline' as const,
      cid: 'telecat-logo',
    };
  }

  private getLogoPath() {
    const candidates = [
      process.env.MAIL_LOGO_PATH,
      join(process.cwd(), '..', 'frontend', 'public', 'logo.svg'),
      join(process.cwd(), 'frontend', 'public', 'logo.svg'),
    ].filter(Boolean) as string[];

    return candidates.find((logoPath) => existsSync(logoPath)) ?? null;
  }

  private ensureConfigured() {
    if (!process.env.MAIL_HOST || !process.env.MAIL_USER || !process.env.MAIL_PASS) {
      throw new ServiceUnavailableException(
        '邮件服务未配置，请设置 MAIL_HOST、MAIL_USER、MAIL_PASS',
      );
    }
  }
}
