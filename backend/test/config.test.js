import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('limite de login usa padrão seguro quando variáveis não são informadas', () => {
  const config = loadConfig({ NODE_ENV: 'test' });

  assert.equal(config.loginRateLimitMax, 5);
  assert.equal(config.loginRateLimitWindow, '15 minutes');
});

test('limite de login aceita configuração temporária por ambiente', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOGIN_RATE_LIMIT_MAX: '20',
    LOGIN_RATE_LIMIT_WINDOW: '15 minutes'
  });

  assert.equal(config.loginRateLimitMax, 20);
  assert.equal(config.loginRateLimitWindow, '15 minutes');
});

test('recuperação de senha possui validade segura e exige configuração explícita de SMTP', () => {
  const defaults = loadConfig({ NODE_ENV: 'test' });
  assert.equal(defaults.passwordResetTtlMinutes, 30);
  assert.equal(defaults.smtpHost, 'smtp.gmail.com');
  assert.equal(defaults.smtpPort, 587);
  assert.equal(defaults.smtpSecure, false);
  assert.equal(defaults.smtpUser, undefined);
  assert.equal(defaults.smtpPass, undefined);
  assert.equal(defaults.emailFrom, undefined);

  const configured = loadConfig({
    NODE_ENV: 'test',
    PASSWORD_RESET_TTL_MINUTES: '45',
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'smtp-user',
    SMTP_PASS: 'smtp-password',
    EMAIL_FROM: 'SEV <acesso@sev.example>'
  });
  assert.equal(configured.passwordResetTtlMinutes, 45);
  assert.equal(configured.smtpHost, 'smtp.example.test');
  assert.equal(configured.smtpPort, 587);
  assert.equal(configured.smtpSecure, false);
  assert.equal(configured.smtpUser, 'smtp-user');
  assert.equal(configured.smtpPass, 'smtp-password');
  assert.equal(configured.emailFrom, 'SEV <acesso@sev.example>');
});

test('chat de suporte possui limites diários seguros e configuráveis', () => {
  const defaults = loadConfig({ NODE_ENV: 'test' });
  assert.equal(defaults.geminiModel, 'gemini-2.5-flash-lite');
  assert.equal(defaults.supportChatUserDailyLimit, 15);
  assert.equal(defaults.supportChatOrganizationDailyLimit, 60);

  const configured = loadConfig({
    NODE_ENV: 'test',
    GEMINI_API_KEY: 'test-key',
    GEMINI_MODEL: 'gemini-2.5-flash',
    SUPPORT_CHAT_USER_DAILY_LIMIT: '9',
    SUPPORT_CHAT_ORGANIZATION_DAILY_LIMIT: '35'
  });
  assert.equal(configured.geminiApiKey, 'test-key');
  assert.equal(configured.geminiModel, 'gemini-2.5-flash');
  assert.equal(configured.supportChatUserDailyLimit, 9);
  assert.equal(configured.supportChatOrganizationDailyLimit, 35);
});

test('cadastro público fica desativado por padrão e pode ser explicitamente habilitado no desenvolvimento', () => {
  assert.equal(loadConfig({ NODE_ENV: 'test' }).publicRegistrationEnabled, false);
  assert.equal(loadConfig({ NODE_ENV: 'test', PUBLIC_REGISTRATION_ENABLED: 'true' }).publicRegistrationEnabled, true);
});
