import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ServiceUnavailableError } from '../errors.js';

const { Pool } = pg;
const tenantRole = 'sev_tenant_api';

const configureTenantTransaction = async (transaction, { organizationId, userId }) => {
  // Fixed identifier, never derived from a request. This role cannot bypass RLS.
  await transaction.query(`SET LOCAL ROLE ${tenantRole}`);
  await transaction.query(
    `SELECT set_config('app.organization_id', $1, true),
            set_config('app.user_id', $2, true)`,
    [organizationId, userId || '']
  );
};

export const createTenantDatabase = (database, tenant) => ({
  available: database.available,
  query: (text, values) => database.transaction(async transaction => {
    await configureTenantTransaction(transaction, tenant);
    return transaction.query(text, values);
  }),
  transaction: callback => database.transaction(async transaction => {
    await configureTenantTransaction(transaction, tenant);
    return callback(transaction);
  })
});

export const createDatabase = config => {
  if (!config.databaseUrl) {
    return {
      available: false,
      query: async () => {
        throw new ServiceUnavailableError('Defina DATABASE_URL para conectar a API ao PostgreSQL.');
      },
      transaction: async () => {
        throw new ServiceUnavailableError('Defina DATABASE_URL para conectar a API ao PostgreSQL.');
      },
      forTenant: () => {
        throw new ServiceUnavailableError('Defina DATABASE_URL para conectar a API ao PostgreSQL.');
      },
      close: async () => {}
    };
  }

  const ca = config.databaseSslCa || (config.databaseSslCaFile
    ? readFileSync(resolve(process.cwd(), config.databaseSslCaFile), 'utf8')
    : undefined);
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    ssl: config.databaseSsl ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : false
  });

  const database = {
    available: true,
    pool,
    query: (text, values) => pool.query(text, values),
    transaction: async callback => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await callback({ query: (text, values) => client.query(text, values) });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end()
  };

  database.forTenant = ({ organizationId, userId }) => createTenantDatabase(database, { organizationId, userId });
  return database;
};
