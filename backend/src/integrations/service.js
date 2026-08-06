import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../errors.js';

export const integrationScopes = ['inventory:write', 'sales:write', 'sync-logs:read'];

export const hashApiKey = value => createHash('sha256').update(value).digest('hex');

export const stableStringify = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

export const hashPayload = value => hashApiKey(stableStringify(value));

export const generateApiKey = () => {
  const secret = `sev_live_${randomBytes(32).toString('base64url')}`;
  return { secret, prefix: secret.slice(0, 17), hash: hashApiKey(secret) };
};

export const createOrganizationApiKey = async (db, { organizationId, userId, name, scopes }) => {
  const key = generateApiKey();
  const result = await db.query(
    `INSERT INTO organization_api_keys (organization_id, name, key_prefix, key_hash, scopes, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5::text[], $6)
     RETURNING id, name, key_prefix AS "keyPrefix", scopes, created_at AS "createdAt"`,
    [organizationId, name, key.prefix, key.hash, scopes, userId]
  );
  return { apiKey: key.secret, key: { ...result.rows[0], revokedAt: null, lastUsedAt: null } };
};

export const listOrganizationApiKeys = async (db, organizationId) => {
  const result = await db.query(
    `SELECT id, name, key_prefix AS "keyPrefix", scopes, created_at AS "createdAt",
            last_used_at AS "lastUsedAt", revoked_at AS "revokedAt"
       FROM organization_api_keys
      WHERE organization_id = $1
      ORDER BY created_at DESC`,
    [organizationId]
  );
  return result.rows;
};

export const revokeOrganizationApiKey = async (db, { organizationId, keyId, userId }) => {
  const result = await db.query(
    `UPDATE organization_api_keys
        SET revoked_at = now(), revoked_by_user_id = $3
      WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL
      RETURNING id, name, key_prefix AS "keyPrefix", scopes, revoked_at AS "revokedAt"`,
    [keyId, organizationId, userId]
  );
  if (!result.rowCount) {
    throw new AppError('Chave de API nao encontrada ou ja revogada.', { statusCode: 404, code: 'API_KEY_NOT_FOUND' });
  }
  return result.rows[0];
};

export const authenticateApiKey = async (database, authorization) => {
  const match = typeof authorization === 'string' && authorization.match(/^Bearer\s+(sev_live_[A-Za-z0-9_-]{32,})$/);
  if (!match) {
    throw new AppError('Informe uma chave de API valida no cabecalho Authorization.', {
      statusCode: 401,
      code: 'API_KEY_INVALID'
    });
  }
  const result = await database.query(
    `SELECT k.id, k.organization_id AS "organizationId", k.name, k.scopes, k.revoked_at AS "revokedAt",
            o.name AS "organizationName", o.is_suspended AS "companySuspended",
            (o.plan_expires_at IS NOT NULL AND o.plan_expires_at < (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS "planExpired"
       FROM organization_api_keys k
       JOIN organizations o ON o.id = k.organization_id
      WHERE k.key_hash = $1
      LIMIT 1`,
    [hashApiKey(match[1])]
  );
  const key = result.rows[0];
  if (!key) throw new AppError('Chave de API invalida.', { statusCode: 401, code: 'API_KEY_INVALID' });
  if (key.revokedAt) throw new AppError('Esta chave de API foi revogada.', { statusCode: 401, code: 'API_KEY_REVOKED' });
  if (key.companySuspended) throw new AppError('O acesso desta empresa esta suspenso.', { statusCode: 403, code: 'COMPANY_SUSPENDED' });
  if (key.planExpired) throw new AppError('O plano desta empresa expirou.', { statusCode: 403, code: 'PLAN_EXPIRED' });
  await database.query('UPDATE organization_api_keys SET last_used_at = now() WHERE id = $1', [key.id]);
  return key;
};

const minuteWindows = new Map();

export const enforceApiRateLimit = async request => {
  const { id: apiKeyId, organizationId } = request.apiAuth;
  const now = Date.now();
  const windowStart = now - 60_000;
  const hits = (minuteWindows.get(organizationId) || []).filter(timestamp => timestamp > windowStart);
  if (hits.length >= request.server.config.integrationApiRateLimitMax) {
    minuteWindows.set(organizationId, hits);
    throw new AppError('Limite de requisicoes por minuto atingido. Tente novamente em instantes.', {
      statusCode: 429,
      code: 'API_RATE_LIMITED',
      details: [{ path: 'rateLimit', message: `Limite de ${request.server.config.integrationApiRateLimitMax} requisicoes por minuto por empresa.` }]
    });
  }
  hits.push(now);
  minuteWindows.set(organizationId, hits);

  const usage = await request.tenantDb.query(
    `INSERT INTO api_daily_usage (organization_id, usage_date, request_count, updated_at)
     VALUES ($1, CURRENT_DATE, 1, now())
     ON CONFLICT (organization_id, usage_date) DO UPDATE
       SET request_count = api_daily_usage.request_count + 1, updated_at = now()
       WHERE api_daily_usage.request_count < $2
     RETURNING request_count`,
    [organizationId, request.server.config.integrationApiDailyLimit]
  );
  if (!usage.rowCount) {
    throw new AppError('Limite diario de integracao atingido. Tente novamente no proximo dia.', {
      statusCode: 429,
      code: 'API_DAILY_LIMITED',
      details: [{ path: 'rateLimit', message: `Limite de ${request.server.config.integrationApiDailyLimit} requisicoes por dia por empresa.` }]
    });
  }
  return { apiKeyId };
};
