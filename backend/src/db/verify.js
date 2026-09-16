import { loadConfig } from '../config.js';
import { createDatabase } from './database.js';

const requiredTables = [
  'organizations',
  'users',
  'organization_memberships',
  'sessions',
  'products',
  'stock_movements',
  'expenses',
  'customers',
  'sales',
  'sale_items',
  'accounts_receivable',
  'support_chat_usage',
  'notifications',
  'audit_logs',
  'platform_administrators',
  'organization_api_keys',
  'api_idempotency_keys',
  'api_sync_logs',
  'api_daily_usage',
  'modulos',
  'empresa_modulos',
  'avaliacoes',
  'avaliacao_questoes',
  'avaliacao_opcoes',
  'avaliacao_tentativas',
  'crm_etapas',
  'crm_negociacoes',
  'crm_tarefas',
  'crm_historico',
  'crm_propostas_itens'
];

const config = loadConfig();
const db = createDatabase(config);

if (!db.available) {
  throw new Error('DATABASE_URL é obrigatória para verificar o banco.');
}

try {
  const result = await db.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [requiredTables]
  );
  const availableTables = new Set(result.rows.map(row => row.table_name));
  const missingTables = requiredTables.filter(table => !availableTables.has(table));
  if (missingTables.length) {
    throw new Error(`Tabelas ausentes: ${missingTables.join(', ')}`);
  }
  console.log(`Banco verificado: ${requiredTables.length} tabelas essenciais disponíveis.`);
} finally {
  await db.close();
}
