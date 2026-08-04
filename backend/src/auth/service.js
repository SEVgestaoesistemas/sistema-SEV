import { randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';
import { recordAudit } from '../audit.js';
import { hashPassword, verifyPassword } from '../security/password.js';
import { createCsrfToken, createSessionId, createSessionToken, hashSessionToken } from '../security/session.js';

const toPublicUser = row => ({
  id: row.user_id,
  name: row.user_name,
  email: row.email,
  organization: {
    id: row.organization_id,
    name: row.organization_name,
    role: row.role
  }
});

const normalizeEmail = email => email.trim().toLowerCase();
const createSlug = value => {
  const base = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return `${base || 'empresa'}-${randomUUID().slice(0, 8)}`;
};

export const createStoredSession = async (db, { userId, organizationId, config }) => {
  const token = createSessionToken();
  const csrfToken = createCsrfToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO sessions (id, user_id, organization_id, token_hash, csrf_token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [createSessionId(), userId, organizationId, hashSessionToken(token), hashSessionToken(csrfToken), expiresAt]
  );
  return { token, csrfToken, expiresAt };
};

export const registerOrganizationOwner = async (db, payload, config) => {
  const email = normalizeEmail(payload.email);
  const passwordHash = await hashPassword(payload.password);

  return db.transaction(async transaction => {
    const existingUser = await transaction.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rowCount) {
      throw new AppError('Não foi possível criar esta conta.', { statusCode: 409, code: 'ACCOUNT_EXISTS' });
    }

    const organization = await transaction.query(
      'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id, name',
      [payload.organizationName.trim(), createSlug(payload.organizationName)]
    );
    const user = await transaction.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [payload.name.trim(), email, passwordHash]
    );
    await transaction.query(
      "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
      [organization.rows[0].id, user.rows[0].id]
    );

    const session = await createStoredSession(transaction, {
      userId: user.rows[0].id,
      organizationId: organization.rows[0].id,
      config
    });
    await recordAudit(transaction, {
      organizationId: organization.rows[0].id,
      actorUserId: user.rows[0].id,
      action: 'auth.register',
      entityType: 'user',
      entityId: user.rows[0].id,
      metadata: { role: 'owner' }
    });

    return {
      session,
      user: {
        id: user.rows[0].id,
        name: user.rows[0].name,
        email: user.rows[0].email,
        organization: { id: organization.rows[0].id, name: organization.rows[0].name, role: 'owner' }
      }
    };
  });
};

export const login = async (db, payload, config) => {
  const email = normalizeEmail(payload.email);
  const result = await db.query(
    `SELECT u.id AS user_id, u.name AS user_name, u.email, u.password_hash,
            o.id AS organization_id, o.name AS organization_name, membership.role
       FROM users u
       JOIN organization_memberships membership ON membership.user_id = u.id
       JOIN organizations o ON o.id = membership.organization_id
      WHERE u.email = $1 AND u.is_active = true
      ORDER BY membership.created_at ASC
      LIMIT 1`,
    [email]
  );
  const account = result.rows[0];
  if (!account || !(await verifyPassword(payload.password, account.password_hash))) {
    throw new AppError('E-mail ou senha inválidos.', { statusCode: 401, code: 'INVALID_CREDENTIALS' });
  }

  return db.transaction(async transaction => {
    const session = await createStoredSession(transaction, {
      userId: account.user_id,
      organizationId: account.organization_id,
      config
    });
    await recordAudit(transaction, {
      organizationId: account.organization_id,
      actorUserId: account.user_id,
      action: 'auth.login',
      entityType: 'session'
    });
    return { session, user: toPublicUser(account) };
  });
};

export const findSession = async (db, token) => {
  if (!token) return null;
  const result = await db.query(
    `SELECT s.id AS session_id, s.csrf_token_hash, u.id AS user_id, u.name AS user_name, u.email,
            o.id AS organization_id, o.name AS organization_name, membership.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN organizations o ON o.id = s.organization_id
       JOIN organization_memberships membership ON membership.organization_id = s.organization_id AND membership.user_id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active = true
      LIMIT 1`,
    [hashSessionToken(token)]
  );
  const row = result.rows[0];
  if (!row) return null;
  await db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]);
  return { ...toPublicUser(row), sessionId: row.session_id, csrfTokenHash: row.csrf_token_hash };
};

export const deleteSession = (db, sessionId) => db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
export const hashCsrfToken = hashSessionToken;
