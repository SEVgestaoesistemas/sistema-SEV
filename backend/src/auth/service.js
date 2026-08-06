import { randomBytes, randomInt, randomUUID } from 'node:crypto';
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
    role: row.role,
    planExpiresAt: row.plan_expires_at || null,
    planStatus: row.plan_expired ? 'expired' : row.plan_expires_at ? 'active' : 'not_configured',
    isSuspended: Boolean(row.is_suspended)
  },
  passwordChangeRequired: Boolean(row.force_password_change),
  planExpired: Boolean(row.plan_expired),
  companySuspended: Boolean(row.is_suspended),
  isPlatformAdmin: Boolean(row.is_platform_admin)
});

const normalizeEmail = email => email.trim().toLowerCase();
export const createSlug = value => {
  const base = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return `${base || 'empresa'}-${randomUUID().slice(0, 8)}`;
};

export const generateTemporaryPassword = () => {
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%*-_'];
  const characters = groups.join('');
  const password = groups.map(group => group[randomInt(group.length)]);
  while (password.length < 16) password.push(characters[randomInt(characters.length)]);
  for (let index = password.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [password[index], password[swapIndex]] = [password[swapIndex], password[index]];
  }
  return password.join('');
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
    `SELECT u.id AS user_id, u.name AS user_name, u.email, u.password_hash, u.force_password_change,
            o.id AS organization_id, o.name AS organization_name, o.plan_expires_at, o.is_suspended, membership.role,
            (o.plan_expires_at IS NOT NULL AND o.plan_expires_at < (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS plan_expired,
            EXISTS (SELECT 1 FROM platform_administrators pa WHERE pa.user_id = u.id) AS is_platform_admin
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
  if (account.plan_expired && !account.is_platform_admin) {
    throw new AppError('O plano desta empresa expirou. Entre em contato com a SEV para regularizar o acesso.', {
      statusCode: 403,
      code: 'PLAN_EXPIRED'
    });
  }
  if (account.is_suspended && !account.is_platform_admin) {
    throw new AppError('O acesso desta empresa está suspenso. Entre em contato com a SEV para regularizar.', {
      statusCode: 403,
      code: 'COMPANY_SUSPENDED'
    });
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
    `SELECT s.id AS session_id, s.csrf_token_hash, u.id AS user_id, u.name AS user_name, u.email, u.force_password_change,
            o.id AS organization_id, o.name AS organization_name, o.plan_expires_at, o.is_suspended, membership.role,
            (o.plan_expires_at IS NOT NULL AND o.plan_expires_at < (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS plan_expired,
            EXISTS (SELECT 1 FROM platform_administrators pa WHERE pa.user_id = u.id) AS is_platform_admin
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

export const changePassword = async (db, { userId, sessionId, currentPassword, newPassword, organizationId }) => db.transaction(async transaction => {
  const result = await transaction.query(
    'SELECT password_hash FROM users WHERE id = $1 AND is_active = true FOR UPDATE',
    [userId]
  );
  const user = result.rows[0];
  if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
    throw new AppError('A senha atual está incorreta.', { statusCode: 401, code: 'INVALID_CURRENT_PASSWORD' });
  }
  const passwordHash = await hashPassword(newPassword);
  await transaction.query(
    'UPDATE users SET password_hash = $2, force_password_change = false WHERE id = $1',
    [userId, passwordHash]
  );
  await transaction.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [userId, sessionId]);
  await recordAudit(transaction, {
    organizationId,
    actorUserId: userId,
    action: 'auth.password_changed',
    entityType: 'user',
    entityId: userId,
    metadata: { revokedOtherSessions: true }
  });
});

export const createPasswordResetRequest = async (db, { email, config }) => {
  const normalizedEmail = normalizeEmail(email);
  return db.transaction(async transaction => {
    const accountResult = await transaction.query(
      `SELECT u.id AS "userId", u.name AS "userName", u.email, membership.organization_id AS "organizationId"
         FROM users u
         JOIN organization_memberships membership ON membership.user_id = u.id
        WHERE u.email = $1 AND u.is_active = true
        ORDER BY membership.created_at ASC
        LIMIT 1
        FOR UPDATE OF u`,
      [normalizedEmail]
    );
    const account = accountResult.rows[0];
    if (!account) return null;

    const recentRequest = await transaction.query(
      `SELECT 1
         FROM password_reset_tokens
        WHERE user_id = $1 AND created_at > now() - interval '5 minutes'
        LIMIT 1`,
      [account.userId]
    );
    if (recentRequest.rowCount) return null;

    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + config.passwordResetTtlMinutes * 60 * 1000);
    await transaction.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [account.userId]);
    const inserted = await transaction.query(
      `INSERT INTO password_reset_tokens (organization_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [account.organizationId, account.userId, tokenHash, expiresAt]
    );
    await recordAudit(transaction, {
      organizationId: account.organizationId,
      action: 'auth.password_reset_requested',
      entityType: 'user',
      entityId: account.userId
    });
    return {
      idempotencyKey: `password-reset-${inserted.rows[0].id}`,
      name: account.userName,
      email: account.email,
      token
    };
  });
};

export const resetPasswordWithToken = async (db, { token, newPassword }) => db.transaction(async transaction => {
  const resetResult = await transaction.query(
    `SELECT reset.id, reset.user_id AS "userId", reset.organization_id AS "organizationId"
       FROM password_reset_tokens reset
       JOIN users u ON u.id = reset.user_id
      WHERE reset.token_hash = $1
        AND reset.used_at IS NULL
        AND reset.expires_at > now()
        AND u.is_active = true
      FOR UPDATE OF reset`,
    [hashSessionToken(token)]
  );
  const reset = resetResult.rows[0];
  if (!reset) {
    throw new AppError('Este link de recuperação é inválido ou expirou. Solicite um novo link.', {
      statusCode: 400,
      code: 'INVALID_PASSWORD_RESET_TOKEN'
    });
  }

  const passwordHash = await hashPassword(newPassword);
  await transaction.query(
    'UPDATE users SET password_hash = $2, force_password_change = false WHERE id = $1',
    [reset.userId, passwordHash]
  );
  await transaction.query('DELETE FROM sessions WHERE user_id = $1', [reset.userId]);
  await transaction.query('UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [reset.userId]);
  await recordAudit(transaction, {
    organizationId: reset.organizationId,
    actorUserId: reset.userId,
    action: 'auth.password_reset_completed',
    entityType: 'user',
    entityId: reset.userId,
    metadata: { revokedAllSessions: true }
  });
});
