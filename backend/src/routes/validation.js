import { z } from 'zod';
import { AppError } from '../errors.js';

const fieldLabels = {
  amountCents: 'valor',
  avatarData: 'imagem de perfil',
  category: 'categoria',
  companyName: 'nome da empresa',
  companyShortName: 'nome curto da empresa',
  confirmationName: 'nome de confirmação',
  currentPassword: 'senha atual',
  customerId: 'cliente',
  description: 'descrição',
  document: 'CPF ou CNPJ',
  documentKey: 'chave de acesso',
  documentNumber: 'número do documento',
  dueDate: 'vencimento',
  email: 'e-mail',
  fileName: 'arquivo XML',
  invoiceItems: 'itens da nota',
  issueDate: 'data de emissão',
  items: 'itens',
  language: 'idioma',
  message: 'mensagem',
  minimumQuantity: 'estoque mínimo',
  name: 'nome',
  newPassword: 'nova senha',
  organizationName: 'nome da empresa',
  password: 'senha',
  paymentMethod: 'forma de pagamento',
  paymentStatus: 'status do pagamento',
  phone: 'telefone',
  planExpiresAt: 'validade do plano',
  productId: 'produto',
  quantity: 'quantidade',
  role: 'papel de acesso',
  sku: 'código do produto',
  startDate: 'início do período',
  endDate: 'fim do período',
  supplierCnpj: 'CNPJ do fornecedor',
  supplierName: 'fornecedor',
  timezone: 'fuso horário',
  token: 'token',
  unitPriceCents: 'preço unitário',
  xmlContent: 'conteúdo do XML'
};

const formatFieldPath = path => {
  if (!path?.length) return 'dados informados';

  return path.map(segment => {
    if (typeof segment === 'number') return `item ${segment + 1}`;
    return fieldLabels[segment] || String(segment)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .toLowerCase();
  }).join(' — ');
};

const itemWord = amount => amount === 1 ? 'item' : 'itens';
const characterWord = amount => amount === 1 ? 'caractere' : 'caracteres';

const isDefaultZodMessage = message => /^(invalid input|invalid (string|email)|too (small|big)|unrecognized key|expected )/i.test(message || '');

const messageForIssue = issue => {
  const field = formatFieldPath(issue.path);

  if (issue.message && !isDefaultZodMessage(issue.message)) return issue.message;
  if (issue.code === 'invalid_type') return `Informe ${field}.`;
  if (issue.code === 'invalid_format' && issue.format === 'email') return 'Informe um e-mail válido.';
  if (issue.code === 'invalid_format') return `Informe ${field} no formato correto.`;
  if (issue.code === 'invalid_value') return `Selecione uma opção válida para ${field}.`;
  if (issue.code === 'too_small') {
    const minimum = Number(issue.minimum);
    if (issue.origin === 'string') return `Informe ${field} com pelo menos ${minimum} ${characterWord(minimum)}.`;
    if (issue.origin === 'array') return `Inclua pelo menos ${minimum} ${itemWord(minimum)} em ${field}.`;
    return `Informe ${field} com valor mínimo de ${minimum}.`;
  }
  if (issue.code === 'too_big') {
    const maximum = Number(issue.maximum);
    if (issue.origin === 'string') return `Informe ${field} com no máximo ${maximum} ${characterWord(maximum)}.`;
    if (issue.origin === 'array') return `Informe no máximo ${maximum} ${itemWord(maximum)} em ${field}.`;
    return `Informe ${field} com valor máximo de ${maximum}.`;
  }
  if (issue.code === 'unrecognized_keys') return 'Há campos não reconhecidos na solicitação.';

  return `Revise o campo ${field}.`;
};

export const validate = (schema, value) => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const fields = result.error.issues.map(issue => ({
    field: formatFieldPath(issue.path),
    message: messageForIssue(issue)
  }));

  throw new AppError(fields[0]?.message || 'Dados inválidos.', {
    statusCode: 400,
    code: 'VALIDATION_ERROR',
    details: { fields }
  });
};

export const emailSchema = z.string().trim().toLowerCase().email().max(160);
export const passwordSchema = z.string().min(12).max(128)
  .regex(/[a-z]/, 'A senha precisa de uma letra minúscula.')
  .regex(/[A-Z]/, 'A senha precisa de uma letra maiúscula.')
  .regex(/[0-9]/, 'A senha precisa de um número.');

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
