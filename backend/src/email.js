import nodemailer from 'nodemailer';
import { AppError } from './errors.js';

const safeSmtpDiagnostic = cause => {
  const code = typeof cause?.code === 'string' && /^[A-Z0-9_-]{2,64}$/.test(cause.code)
    ? cause.code
    : 'SMTP_SEND_FAILED';
  const command = typeof cause?.command === 'string' && /^[A-Z0-9 _.-]{2,64}$/i.test(cause.command)
    ? cause.command
    : undefined;
  const responseCode = Number.isInteger(cause?.responseCode) && cause.responseCode >= 100 && cause.responseCode <= 599
    ? cause.responseCode
    : undefined;
  return { code, ...(command ? { command } : {}), ...(responseCode ? { responseCode } : {}) };
};

const emailUnavailable = cause => {
  const error = new AppError(
    'A recuperação de senha está temporariamente indisponível. Tente novamente mais tarde ou fale com o suporte.',
    { statusCode: 503, code: 'EMAIL_DELIVERY_UNAVAILABLE' }
  );
  error.smtpDiagnostic = safeSmtpDiagnostic(cause);
  return error;
};

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
      if (!result.accepted?.includes(to)) {
        const rejected = new Error('SMTP não aceitou o destinatário.');
        rejected.code = 'SMTP_RECIPIENT_REJECTED';
        throw rejected;
      }
    } catch (error) {
      throw emailUnavailable(error);
    }
  };
};
