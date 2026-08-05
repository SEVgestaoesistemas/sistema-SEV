import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors.js';
import { recordAudit } from '../audit.js';
import { createSlug, generateTemporaryPassword } from '../auth/service.js';
import { hashPassword } from '../security/password.js';

const normalizeEmail = email => email.trim().toLowerCase();

const statusFromPlan = planExpiresAt => {
  if (!planExpiresAt) return 'not_configured';
  const today = new Date().toISOString().slice(0, 10);
  return planExpiresAt < today ? 'expired' : 'active';
};

const toCompany = row => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt,
  planExpiresAt: row.planExpiresAt || null,
  planStatus: row.planStatus || statusFromPlan(row.planExpiresAt),
  administrator: row.administratorId ? {
    id: row.administratorId,
    name: row.administratorName,
    email: row.administratorEmail
  } : null
});

export const listCompanies = async db => {
  const result = await db.query(
    `SELECT o.id, o.name, o.created_at AS "createdAt", o.plan_expires_at AS "planExpiresAt",
            CASE
              WHEN o.plan_expires_at IS NULL THEN 'not_configured'
              WHEN o.plan_expires_at < CURRENT_DATE THEN 'expired'
              ELSE 'active'
            END AS "planStatus",
            owner_user.id AS "administratorId", owner_user.name AS "administratorName", owner_user.email AS "administratorEmail"
       FROM organizations o
       LEFT JOIN LATERAL (
         SELECT u.id, u.name, u.email
           FROM organization_memberships membership
           JOIN users u ON u.id = membership.user_id
          WHERE membership.organization_id = o.id AND membership.role = 'owner'
          ORDER BY membership.created_at ASC
          LIMIT 1
       ) owner_user ON true
      ORDER BY o.created_at DESC`
  );
  return result.rows.map(toCompany);
};

export const createCompany = async (db, payload, actor) => db.transaction(async transaction => {
  const email = normalizeEmail(payload.administratorEmail);
  const existingUser = await transaction.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existingUser.rowCount) {
    throw new AppError('Já existe uma conta com este e-mail.', { statusCode: 409, code: 'ACCOUNT_EXISTS' });
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const organizationResult = await transaction.query(
    `INSERT INTO organizations (name, slug, plan_expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, name, created_at AS "createdAt", plan_expires_at AS "planExpiresAt"`,
    [payload.companyName.trim(), createSlug(payload.companyName), payload.planExpiresAt]
  );
  const company = organizationResult.rows[0];
  const userResult = await transaction.query(
    `INSERT INTO users (name, email, password_hash, force_password_change)
     VALUES ($1, $2, $3, true)
     RETURNING id, name, email`,
    [payload.administratorName.trim(), email, passwordHash]
  );
  const administrator = userResult.rows[0];
  await transaction.query(
    "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
    [company.id, administrator.id]
  );
  await recordAudit(transaction, {
    organizationId: company.id,
    actorUserId: actor.id,
    action: 'platform.company_created',
    entityType: 'organization',
    entityId: company.id,
    metadata: { createdByPlatformAdmin: actor.id, administratorId: administrator.id, planExpiresAt: company.planExpiresAt }
  });
  return {
    company: toCompany({ ...company, planStatus: statusFromPlan(company.planExpiresAt), administratorId: administrator.id, administratorName: administrator.name, administratorEmail: administrator.email }),
    administrator: { id: administrator.id, name: administrator.name, email: administrator.email, temporaryPassword }
  };
});

export const updateCompanyPlan = async (db, companyId, planExpiresAt, actor) => db.transaction(async transaction => {
  const result = await transaction.query(
    `UPDATE organizations
        SET plan_expires_at = $2
      WHERE id = $1
      RETURNING id, name, created_at AS "createdAt", plan_expires_at AS "planExpiresAt"`,
    [companyId, planExpiresAt]
  );
  if (!result.rowCount) {
    throw new AppError('Empresa não encontrada.', { statusCode: 404, code: 'COMPANY_NOT_FOUND' });
  }
  const company = result.rows[0];
  await recordAudit(transaction, {
    organizationId: company.id,
    actorUserId: actor.id,
    action: 'platform.plan_updated',
    entityType: 'organization',
    entityId: company.id,
    metadata: { planExpiresAt: company.planExpiresAt }
  });
  return toCompany({ ...company, planStatus: statusFromPlan(company.planExpiresAt) });
});

const safeTokenMatch = (providedToken, expectedToken) => {
  const provided = Buffer.from(providedToken || '', 'utf8');
  const expected = Buffer.from(expectedToken || '', 'utf8');
  return provided.length === expected.length && provided.length > 0 && timingSafeEqual(provided, expected);
};

export const bootstrapPlatformAdministrator = async (db, { email, token }, config) => {
  if (!config.platformBootstrapToken || !safeTokenMatch(token, config.platformBootstrapToken)) {
    throw new AppError('Credenciais de inicialização inválidas.', { statusCode: 403, code: 'INVALID_BOOTSTRAP' });
  }

  return db.transaction(async transaction => {
    const existingAdministrator = await transaction.query('SELECT user_id FROM platform_administrators LIMIT 1 FOR UPDATE');
    if (existingAdministrator.rowCount) {
      throw new AppError('O administrador da plataforma já foi configurado.', { statusCode: 409, code: 'PLATFORM_ADMIN_EXISTS' });
    }
    const user = await transaction.query(
      `SELECT u.id, u.name, u.email
         FROM users u
        WHERE u.email = $1 AND u.is_active = true
        FOR UPDATE`,
      [normalizeEmail(email)]
    );
    if (!user.rowCount) {
      throw new AppError('Nenhum usuário ativo foi encontrado para este e-mail.', { statusCode: 404, code: 'USER_NOT_FOUND' });
    }
    await transaction.query('INSERT INTO platform_administrators (user_id) VALUES ($1)', [user.rows[0].id]);
    return { administrator: user.rows[0] };
  });
};
