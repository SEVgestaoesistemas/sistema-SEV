import { z } from 'zod';

const optionalText = z.preprocess(
  value => typeof value === 'string' && !value.trim() ? undefined : value,
  z.string().trim().min(1).optional()
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  HOST: z.string().min(1).default('127.0.0.1'),
  FRONTEND_ORIGIN: z.string().min(1).default('http://127.0.0.1:5500'),
  FRONTEND_URL: optionalText,
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  SESSION_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100).default(5),
  LOGIN_RATE_LIMIT_WINDOW: z.string().trim().regex(
    /^\d+\s*(second|seconds|minute|minutes|hour|hours)$/i,
    'LOGIN_RATE_LIMIT_WINDOW deve usar um valor como "15 minutes".'
  ).default('15 minutes'),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(10).max(120).default(30),
  SMTP_HOST: z.string().trim().min(1).max(255).default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: optionalText,
  SMTP_PASS: optionalText,
  EMAIL_FROM: optionalText,
  GEMINI_API_KEY: optionalText,
  GEMINI_MODEL: z.string().trim().regex(/^[a-zA-Z0-9._-]+$/).default('gemini-2.5-flash-lite'),
  SUPPORT_CHAT_USER_DAILY_LIMIT: z.coerce.number().int().min(1).max(100).default(15),
  SUPPORT_CHAT_ORGANIZATION_DAILY_LIMIT: z.coerce.number().int().min(1).max(1000).default(60),
  PUBLIC_REGISTRATION_ENABLED: z.enum(['true', 'false']).default('false'),
  PLATFORM_BOOTSTRAP_TOKEN: optionalText,
  TRUST_PROXY: z.enum(['true', 'false']).optional(),
  DATABASE_SSL: z.enum(['true', 'false']).optional(),
  DATABASE_SSL_CA_FILE: optionalText,
  DATABASE_SSL_CA: optionalText,
  DATABASE_URL: z.preprocess(
    value => typeof value === 'string' && !value.trim() ? undefined : value,
    z.string().url().optional()
  )
});

export const loadConfig = (environment = process.env) => {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(`Configuração inválida: ${parsed.error.issues.map(issue => issue.message).join(', ')}`);
  }

  const values = parsed.data;
  if (values.NODE_ENV === 'production' && !values.DATABASE_URL) {
    throw new Error('DATABASE_URL é obrigatória em produção.');
  }

  return {
    environment: values.NODE_ENV,
    port: values.PORT,
    host: values.HOST,
    allowedOrigins: values.FRONTEND_ORIGIN.split(',').map(origin => origin.trim()).filter(Boolean),
    frontendUrl: (values.FRONTEND_URL ?? values.FRONTEND_ORIGIN.split(',')[0]).replace(/\/+$/, ''),
    sessionTtlDays: values.SESSION_TTL_DAYS,
    sessionSameSite: values.SESSION_SAME_SITE,
    loginRateLimitMax: values.LOGIN_RATE_LIMIT_MAX,
    loginRateLimitWindow: values.LOGIN_RATE_LIMIT_WINDOW,
    passwordResetTtlMinutes: values.PASSWORD_RESET_TTL_MINUTES,
    smtpHost: values.SMTP_HOST,
    smtpPort: values.SMTP_PORT,
    smtpSecure: values.SMTP_SECURE === 'true',
    smtpUser: values.SMTP_USER,
    smtpPass: values.SMTP_PASS,
    emailFrom: values.EMAIL_FROM,
    geminiApiKey: values.GEMINI_API_KEY,
    geminiModel: values.GEMINI_MODEL,
    supportChatUserDailyLimit: values.SUPPORT_CHAT_USER_DAILY_LIMIT,
    supportChatOrganizationDailyLimit: values.SUPPORT_CHAT_ORGANIZATION_DAILY_LIMIT,
    publicRegistrationEnabled: values.PUBLIC_REGISTRATION_ENABLED === 'true',
    platformBootstrapToken: values.PLATFORM_BOOTSTRAP_TOKEN,
    trustProxy: values.TRUST_PROXY ? values.TRUST_PROXY === 'true' : values.NODE_ENV === 'production',
    databaseUrl: values.DATABASE_URL,
    databaseSsl: values.DATABASE_SSL ? values.DATABASE_SSL === 'true' : values.NODE_ENV === 'production',
    databaseSslCaFile: values.DATABASE_SSL_CA_FILE,
    databaseSslCa: values.DATABASE_SSL_CA
  };
};
