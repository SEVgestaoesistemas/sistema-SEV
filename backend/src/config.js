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
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  SESSION_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100).default(5),
  LOGIN_RATE_LIMIT_WINDOW: z.string().trim().regex(
    /^\d+\s*(second|seconds|minute|minutes|hour|hours)$/i,
    'LOGIN_RATE_LIMIT_WINDOW deve usar um valor como "15 minutes".'
  ).default('15 minutes'),
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
    sessionTtlDays: values.SESSION_TTL_DAYS,
    sessionSameSite: values.SESSION_SAME_SITE,
    loginRateLimitMax: values.LOGIN_RATE_LIMIT_MAX,
    loginRateLimitWindow: values.LOGIN_RATE_LIMIT_WINDOW,
    publicRegistrationEnabled: values.PUBLIC_REGISTRATION_ENABLED === 'true',
    platformBootstrapToken: values.PLATFORM_BOOTSTRAP_TOKEN,
    trustProxy: values.TRUST_PROXY ? values.TRUST_PROXY === 'true' : values.NODE_ENV === 'production',
    databaseUrl: values.DATABASE_URL,
    databaseSsl: values.DATABASE_SSL ? values.DATABASE_SSL === 'true' : values.NODE_ENV === 'production',
    databaseSslCaFile: values.DATABASE_SSL_CA_FILE,
    databaseSslCa: values.DATABASE_SSL_CA
  };
};
