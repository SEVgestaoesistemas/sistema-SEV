import { z } from 'zod';
import { AppError } from '../errors.js';

export const validate = (schema, value) => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError('Dados inválidos.', {
    statusCode: 400,
    code: 'VALIDATION_ERROR'
  });
};

export const emailSchema = z.string().trim().toLowerCase().email().max(160);
export const passwordSchema = z.string().min(12).max(128)
  .regex(/[a-z]/, 'A senha precisa de uma letra minúscula.')
  .regex(/[A-Z]/, 'A senha precisa de uma letra maiúscula.')
  .regex(/[0-9]/, 'A senha precisa de um número.');

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
