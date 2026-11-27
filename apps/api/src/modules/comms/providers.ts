import nodemailer from 'nodemailer';
import type { Config } from '../../config.js';

export interface MailMessage { to: string; from: string; subject: string; text: string; html: string; idempotencyKey: string }
export interface Mailer { send(message: MailMessage): Promise<{ messageId: string }> }
export interface SmsMessage { to: string; from: string; body: string; idempotencyKey: string }
export interface SmsSender { send(message: SmsMessage): Promise<{ messageId: string }> }
export class DeliveryError extends Error { constructor(message: string, public readonly permanent = false, public readonly kind: 'permanent' | 'suppressed' = 'permanent') { super(message); } }

export interface LoggedMail extends MailMessage { provider: 'log' }
export class LogMailer implements Mailer {
  readonly messages: LoggedMail[] = [];
  async send(message: MailMessage): Promise<{ messageId: string }> {
    this.messages.push({ ...message, provider: 'log' });
    return { messageId: `log-${message.idempotencyKey}` };
  }
}
export class SmtpMailer implements Mailer {
  private readonly transport;
  constructor(cfg: Config) {
    if (!cfg.SMTP_HOST || !cfg.SMTP_USER || !cfg.SMTP_PASSWORD) throw new Error('SMTP configuration is incomplete');
    this.transport = nodemailer.createTransport({ host: cfg.SMTP_HOST, port: cfg.SMTP_PORT, secure: cfg.SMTP_SECURE === 'true', auth: { user: cfg.SMTP_USER, pass: cfg.SMTP_PASSWORD } });
  }
  async send(message: MailMessage): Promise<{ messageId: string }> {
    try {
      const info = await this.transport.sendMail({ from: message.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
      return { messageId: String(info.messageId ?? `smtp-${message.idempotencyKey}`) };
    } catch (e) { throw new DeliveryError(`SMTP delivery failed: ${(e as Error).message.slice(0, 180)}`); }
  }
}
export class PostmarkMailer implements Mailer {
  constructor(private readonly cfg: Config, private readonly fetcher: typeof fetch = fetch) {}
  async send(message: MailMessage): Promise<{ messageId: string }> {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const res = await this.fetcher(`${this.cfg.POSTMARK_API_BASE}/email`, { method: 'POST', signal: ctl.signal,
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': this.cfg.POSTMARK_TOKEN ?? '' },
        body: JSON.stringify({ From: message.from, To: message.to, Subject: message.subject, TextBody: message.text, HtmlBody: message.html, MessageStream: 'outbound' }) });
      if (!res.ok) {
        const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
        throw new DeliveryError(`Postmark rejected message (HTTP ${res.status})`, permanent);
      }
      const data = await res.json() as { MessageID?: string };
      return { messageId: data.MessageID ?? `postmark-${message.idempotencyKey}` };
    } catch (e) {
      if (e instanceof DeliveryError) throw e;
      throw new DeliveryError(`Postmark delivery failed: ${(e as Error).message.slice(0, 180)}`);
    } finally { clearTimeout(timer); }
  }
}
export function mailerFor(cfg: Config): Mailer {
  if (cfg.MAIL_PROVIDER === 'smtp') return new SmtpMailer(cfg);
  if (cfg.MAIL_PROVIDER === 'postmark') return new PostmarkMailer(cfg);
  return new LogMailer();
}

export class LogSender implements SmsSender {
  readonly messages: SmsMessage[] = [];
  async send(message: SmsMessage): Promise<{ messageId: string }> { this.messages.push(message); return { messageId: `log-sms-${message.idempotencyKey}` }; }
}
export class TwilioSender implements SmsSender {
  constructor(private readonly cfg: Config, private readonly fetcher: typeof fetch = fetch) {}
  async send(message: SmsMessage): Promise<{ messageId: string }> {
    const sid = this.cfg.TWILIO_ACCOUNT_SID ?? ''; const token = this.cfg.TWILIO_AUTH_TOKEN ?? '';
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 5000);
    try {
      const form = new URLSearchParams({ To: message.to, From: message.from, Body: message.body });
      const res = await this.fetcher(`${this.cfg.TWILIO_API_BASE}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, { method: 'POST', signal: ctl.signal,
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
      if (!res.ok) throw new DeliveryError(`Twilio rejected message (HTTP ${res.status})`, res.status >= 400 && res.status < 500 && res.status !== 429);
      const data = await res.json() as { sid?: string }; return { messageId: data.sid ?? `twilio-${message.idempotencyKey}` };
    } catch (e) { if (e instanceof DeliveryError) throw e; throw new DeliveryError(`Twilio delivery failed: ${(e as Error).message.slice(0, 180)}`); }
    finally { clearTimeout(timer); }
  }
}
export function smsSenderFor(cfg: Config): SmsSender { return cfg.SMS_PROVIDER === 'twilio' ? new TwilioSender(cfg) : new LogSender(); }
