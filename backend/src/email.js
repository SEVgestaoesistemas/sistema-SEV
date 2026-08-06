import nodemailer from 'nodemailer';
import { AppError } from './errors.js';

const emailUnavailable = () => new AppError(
  'A recuperação de senha está temporariamente indisponível. Tente novamente mais tarde ou fale com o suporte.',
  { statusCode: 503, code: 'EMAIL_DELIVERY_UNAVAILABLE' }
);

export const createEmailSender = (config, { createTransport = nodemailer.createTransport } = {}) => {
  if (!config.smtpUser || !config.smtpPass || !config.emailFrom) return null;

  const transporter = createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: { user: config.smtpUser, pass: config.smtpPass },
    tls: { minVersion: 'TLSv1.2' },
    disableFileAccess: true,
    disableUrlAccess: true
  });

  return async ({ to, subject, text, html, idempotencyKey }) => {
    try {
      const result = await transporter.sendMail({
        from: config.emailFrom,
        to,
        subject,
        text,
        html,
        headers: { 'X-SEV-Message-Key': idempotencyKey }
      });
      if (!result.accepted?.includes(to)) throw new Error('SMTP não aceitou o destinatário.');
    } catch {
      throw emailUnavailable();
    }
  };
};
