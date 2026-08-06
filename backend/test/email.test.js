import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailSender } from '../src/email.js';

const smtpConfig = {
  smtpHost: 'smtp.gmail.com',
  smtpPort: 465,
  smtpSecure: true,
  smtpUser: 'sevgestaosistemas@gmail.com',
  smtpPass: 'app-password-not-real',
  emailFrom: 'SEV Gestão & Sistemas <sevgestaosistemas@gmail.com>'
};

test('SMTP só é habilitado quando todos os segredos necessários existem', () => {
  assert.equal(createEmailSender({ ...smtpConfig, smtpPass: undefined }), null);
  assert.equal(createEmailSender({ ...smtpConfig, smtpUser: undefined }), null);
  assert.equal(createEmailSender({ ...smtpConfig, emailFrom: undefined }), null);
});

test('e-mail de recuperação usa SMTP seguro e não permite conteúdo externo', async () => {
  let transportOptions;
  let sentMessage;
  const sender = createEmailSender(smtpConfig, {
    createTransport: options => {
      transportOptions = options;
      return {
        sendMail: async message => {
          sentMessage = message;
          return { accepted: [message.to] };
        }
      };
    }
  });

  await sender({
    to: 'cliente@example.test',
    subject: 'Redefina sua senha',
    text: 'Mensagem segura',
    html: '<p>Mensagem segura</p>',
    idempotencyKey: 'password-reset-test'
  });

  assert.deepEqual(transportOptions, {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: 'sevgestaosistemas@gmail.com', pass: 'app-password-not-real' },
    tls: { minVersion: 'TLSv1.2' },
    disableFileAccess: true,
    disableUrlAccess: true
  });
  assert.equal(sentMessage.from, smtpConfig.emailFrom);
  assert.equal(sentMessage.headers['X-SEV-Message-Key'], 'password-reset-test');
});

test('falha de SMTP preserva diagnóstico seguro sem expor detalhes do provedor', async () => {
  const sender = createEmailSender(smtpConfig, {
    createTransport: () => ({
      sendMail: async () => {
        const error = new Error('535 5.7.8 Username and Password not accepted: app-password-not-real');
        error.code = 'EAUTH';
        error.command = 'AUTH PLAIN';
        error.responseCode = 535;
        throw error;
      }
    })
  });

  await assert.rejects(
    () => sender({ to: 'cliente@example.test', subject: 'x', text: 'x', html: '<p>x</p>', idempotencyKey: 'test' }),
    error => error.code === 'EMAIL_DELIVERY_UNAVAILABLE'
      && error.statusCode === 503
      && !/app-password-not-real|Username and Password/i.test(error.message)
      && Object.hasOwn(error, 'smtpDiagnostic')
      && error.smtpDiagnostic.code === 'EAUTH'
      && error.smtpDiagnostic.command === 'AUTH PLAIN'
      && error.smtpDiagnostic.responseCode === 535
  );
});
