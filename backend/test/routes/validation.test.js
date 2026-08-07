import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { AppError } from '../../src/errors.js';
import { passwordSchema, validate } from '../../src/routes/validation.js';

test('validação informa com segurança o primeiro campo inválido e a lista de campos', () => {
  const schema = z.object({
    email: z.string().email(),
    quantity: z.coerce.number().int().min(1),
    items: z.array(z.string()).min(1)
  });

  assert.throws(() => validate(schema, {
    email: 'cliente-sem-arroba',
    quantity: 0,
    items: []
  }), error => {
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.equal(error.message, 'Informe um e-mail válido.');
    assert.deepEqual(error.details, {
      fields: [
        { field: 'e-mail', message: 'Informe um e-mail válido.' },
        { field: 'quantidade', message: 'Informe quantidade com valor mínimo de 1.' },
        { field: 'itens', message: 'Inclua pelo menos 1 item em itens.' }
      ]
    });
    return true;
  });
});

test('validação preserva mensagens específicas definidas pela regra de negócio', () => {
  const schema = z.object({
    dueDate: z.string().optional()
  }).superRefine((value, context) => {
    if (!value.dueDate) {
      context.addIssue({
        code: 'custom',
        path: ['dueDate'],
        message: 'Informe o vencimento para uma venda a prazo.'
      });
    }
  });

  assert.throws(() => validate(schema, {}), error => {
    assert.ok(error instanceof AppError);
    assert.equal(error.message, 'Informe o vencimento para uma venda a prazo.');
    assert.deepEqual(error.details, {
      fields: [{ field: 'vencimento', message: 'Informe o vencimento para uma venda a prazo.' }]
    });
    return true;
  });
});

test('validação preserva instruções específicas de formato definidas no schema', () => {
  assert.throws(() => validate(passwordSchema, 'apenasletrasminusculas'), error => {
    assert.ok(error instanceof AppError);
    assert.equal(error.message, 'A senha precisa de uma letra maiúscula.');
    return true;
  });
});

test('validação não expõe a mensagem padrão em inglês do Zod', () => {
  const schema = z.object({
    fileName: z.string().refine(value => value.endsWith('.xml'))
  });

  assert.throws(() => validate(schema, { fileName: 'nota.txt' }), error => {
    assert.ok(error instanceof AppError);
    assert.equal(error.message, 'Revise o campo arquivo XML.');
    return true;
  });
});
