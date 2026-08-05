import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors.js';
import { recordAudit } from '../audit.js';
import { createSlug, generateTemporaryPassword } from '../auth/service.js';
import { hashPassword } from '../security/password.js';

const normalizeEmail = email => email.trim().toLowerCase();
const dateOnly = value => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
};

const saoPauloToday = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const statusFromPlan = planExpiresAt => {
  const planDate = dateOnly(planExpiresAt);
  if (!planDate) return 'not_configured';
  return planDate < saoPauloToday() ? 'expired' : 'active';
};

const toCompany = row => ({
  id: row.id,
  name: row.name,
  createdAt: row.createdAt,
  planExpiresAt: dateOnly(row.planExpiresAt),
  planStatus: row.planStatus || statusFromPlan(row.planExpiresAt),
  isSuspended: Boolean(row.isSuspended),
  suspendedAt: row.suspendedAt || null,
  containsPlatformAdmin: Boolean(row.containsPlatformAdmin),
  administrator: row.administratorId ? {
    id: row.administratorId,
    name: row.administratorName,
    email: row.administratorEmail
  } : null
});

const companySelect = `SELECT o.id, o.name, o.created_at AS "createdAt", o.plan_expires_at AS "planExpiresAt",
            o.is_suspended AS "isSuspended", o.suspended_at AS "suspendedAt",
            CASE
              WHEN o.plan_expires_at IS NULL THEN 'not_configured'
              WHEN o.plan_expires_at < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'expired'
              ELSE 'active'
            END AS "planStatus",
            owner_user.id AS "administratorId", owner_user.name AS "administratorName", owner_user.email AS "administratorEmail",
            EXISTS (
              SELECT 1 FROM organization_memberships platform_membership
              JOIN platform_administrators pa ON pa.user_id = platform_membership.user_id
              WHERE platform_membership.organization_id = o.id
            ) AS "containsPlatformAdmin"
       FROM organizations o
       LEFT JOIN LATERAL (
         SELECT u.id, u.name, u.email
           FROM organization_memberships membership
           JOIN users u ON u.id = membership.user_id
          WHERE membership.organization_id = o.id AND membership.role = 'owner'
          ORDER BY membership.created_at ASC
          LIMIT 1
       ) owner_user ON true`;

const findCompany = async (db, companyId) => {
  const result = await db.query(`${companySelect} WHERE o.id = $1`, [companyId]);
  return result.rowCount ? toCompany(result.rows[0]) : null;
};

const requireCompany = async (db, companyId) => {
  const company = await findCompany(db, companyId);
  if (!company) throw new AppError('Empresa não encontrada.', { statusCode: 404, code: 'COMPANY_NOT_FOUND' });
  return company;
};

const requireCompanyAdministrator = async (db, companyId) => {
  const result = await db.query(
    `SELECT o.id AS "companyId", o.name AS "companyName", u.id AS "administratorId", u.name AS "administratorName", u.email AS "administratorEmail",
            EXISTS (SELECT 1 FROM platform_administrators pa WHERE pa.user_id = u.id) AS "isPlatformAdministrator"
       FROM organizations o
       JOIN organization_memberships membership ON membership.organization_id = o.id AND membership.role = 'owner'
       JOIN users u ON u.id = membership.user_id
      WHERE o.id = $1
      ORDER BY membership.created_at ASC
      LIMIT 1
      FOR UPDATE OF o, u`,
    [companyId]
  );
  if (!result.rowCount) {
    throw new AppError('Responsável da empresa não encontrado.', { statusCode: 404, code: 'ADMINISTRATOR_NOT_FOUND' });
  }
  return result.rows[0];
};

const preventPlatformAdministratorChange = administrator => {
  if (administrator.isPlatformAdministrator) {
    throw new AppError('A conta do administrador da plataforma não pode ser alterada por esta tela.', {
      statusCode: 403,
      code: 'PLATFORM_ADMIN_PROTECTED'
    });
  }
};

export const listCompanies = async db => {
  const result = await db.query(`${companySelect} ORDER BY o.created_at DESC`);
  return result.rows.map(toCompany);
};

export const listCompanySupportConversations = async (db, companyId) => {
  const company = await requireCompany(db, companyId);
  const result = await db.query(
    `SELECT conversation.id, conversation.question, conversation.answer,
            conversation.in_scope AS "inScope", conversation.needs_human AS "needsHuman",
            conversation.created_at AS "createdAt", user_account.name AS "userName"
       FROM support_chat_conversations conversation
       LEFT JOIN users user_account ON user_account.id = conversation.user_id
      WHERE conversation.organization_id = $1
      ORDER BY conversation.created_at DESC
      LIMIT 100`,
    [companyId]
  );
  return { company, conversations: result.rows };
};

export const listSupportEscalations = async db => {
  const result = await db.query(
    `SELECT conversation.id, conversation.question, conversation.answer,
            conversation.in_scope AS "inScope", conversation.created_at AS "createdAt",
            organization.id AS "companyId", organization.name AS "companyName", user_account.name AS "userName"
       FROM support_chat_conversations conversation
       JOIN organizations organization ON organization.id = conversation.organization_id
       LEFT JOIN users user_account ON user_account.id = conversation.user_id
      WHERE conversation.needs_human = true
      ORDER BY conversation.created_at DESC
      LIMIT 100`
  );
  return result.rows;
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
     RETURNING id`,
    [payload.companyName.trim(), createSlug(payload.companyName), payload.planExpiresAt]
  );
  const companyId = organizationResult.rows[0].id;
  const userResult = await transaction.query(
    `INSERT INTO users (name, email, password_hash, force_password_change)
     VALUES ($1, $2, $3, true)
     RETURNING id, name, email`,
    [payload.administratorName.trim(), email, passwordHash]
  );
  const administrator = userResult.rows[0];
  await transaction.query(
    "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
    [companyId, administrator.id]
  );
  const company = await requireCompany(transaction, companyId);
  await recordAudit(transaction, {
    organizationId: companyId,
    actorUserId: actor.id,
    action: 'platform.company_created',
    entityType: 'organization',
    entityId: companyId,
    metadata: { createdByPlatformAdmin: actor.id, administratorId: administrator.id, planExpiresAt: company.planExpiresAt }
  });
  return {
    company,
    administrator: { id: administrator.id, name: administrator.name, email: administrator.email, temporaryPassword }
  };
});

export const updateCompanyPlan = async (db, companyId, planExpiresAt, actor) => db.transaction(async transaction => {
  const updated = await transaction.query('UPDATE organizations SET plan_expires_at = $2 WHERE id = $1 RETURNING id', [companyId, planExpiresAt]);
  if (!updated.rowCount) throw new AppError('Empresa não encontrada.', { statusCode: 404, code: 'COMPANY_NOT_FOUND' });
  const company = await requireCompany(transaction, companyId);
  await recordAudit(transaction, {
    organizationId: companyId,
    actorUserId: actor.id,
    action: 'platform.plan_updated',
    entityType: 'organization',
    entityId: companyId,
    metadata: { planExpiresAt: company.planExpiresAt }
  });
  return company;
});

export const setCompanySuspension = async (db, companyId, suspended, actor) => db.transaction(async transaction => {
  const updated = await transaction.query(
    `UPDATE organizations
        SET is_suspended = $2, suspended_at = CASE WHEN $2 THEN now() ELSE NULL END
      WHERE id = $1
      RETURNING id`,
    [companyId, suspended]
  );
  if (!updated.rowCount) throw new AppError('Empresa não encontrada.', { statusCode: 404, code: 'COMPANY_NOT_FOUND' });
  const company = await requireCompany(transaction, companyId);
  await recordAudit(transaction, {
    organizationId: companyId,
    actorUserId: actor.id,
    action: suspended ? 'platform.company_suspended' : 'platform.company_reactivated',
    entityType: 'organization',
    entityId: companyId,
    metadata: { suspended }
  });
  return company;
});

export const updateCompanyAdministrator = async (db, companyId, payload, actor) => db.transaction(async transaction => {
  const administrator = await requireCompanyAdministrator(transaction, companyId);
  preventPlatformAdministratorChange(administrator);
  const email = normalizeEmail(payload.administratorEmail);
  const duplicate = await transaction.query('SELECT id FROM users WHERE email = $1 AND id <> $2', [email, administrator.administratorId]);
  if (duplicate.rowCount) throw new AppError('Já existe uma conta com este e-mail.', { statusCode: 409, code: 'ACCOUNT_EXISTS' });
  await transaction.query('UPDATE users SET name = $2, email = $3 WHERE id = $1', [administrator.administratorId, payload.administratorName.trim(), email]);
  const company = await requireCompany(transaction, companyId);
  await recordAudit(transaction, {
    organizationId: companyId,
    actorUserId: actor.id,
    action: 'platform.company_administrator_updated',
    entityType: 'user',
    entityId: administrator.administratorId,
    metadata: { fields: ['name', 'email'] }
  });
  return company;
});

export const resetCompanyAdministratorPassword = async (db, companyId, actor) => db.transaction(async transaction => {
  const administrator = await requireCompanyAdministrator(transaction, companyId);
  preventPlatformAdministratorChange(administrator);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await transaction.query(
    'UPDATE users SET password_hash = $2, force_password_change = true WHERE id = $1',
    [administrator.administratorId, passwordHash]
  );
  await transaction.query('DELETE FROM sessions WHERE user_id = $1', [administrator.administratorId]);
  const company = await requireCompany(transaction, companyId);
  await recordAudit(transaction, {
    organizationId: companyId,
    actorUserId: actor.id,
    action: 'platform.administrator_temporary_password_reset',
    entityType: 'user',
    entityId: administrator.administratorId
  });
  return {
    company,
    administrator: {
      id: administrator.administratorId,
      name: administrator.administratorName,
      email: administrator.administratorEmail,
      temporaryPassword
    }
  };
});

export const deleteCompanyPermanently = async (db, companyId, confirmationName, actor) => db.transaction(async transaction => {
  const company = await requireCompany(transaction, companyId);
  if (company.containsPlatformAdmin) {
    throw new AppError('Não é permitido excluir a empresa vinculada a um administrador da plataforma.', {
      statusCode: 403,
      code: 'PLATFORM_ADMIN_COMPANY_PROTECTED'
    });
  }
  if (confirmationName.trim() !== company.name) {
    throw new AppError('A confirmação não corresponde ao nome da empresa.', { statusCode: 400, code: 'DELETE_CONFIRMATION_MISMATCH' });
  }
  const members = await transaction.query('SELECT user_id FROM organization_memberships WHERE organization_id = $1', [companyId]);
  const userIds = members.rows.map(member => member.user_id);
  await transaction.query('DELETE FROM organizations WHERE id = $1', [companyId]);
  if (userIds.length) {
    await transaction.query(
      `DELETE FROM users u
        WHERE u.id = ANY($1::uuid[])
          AND NOT EXISTS (SELECT 1 FROM organization_memberships membership WHERE membership.user_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM platform_administrators pa WHERE pa.user_id = u.id)`,
      [userIds]
    );
  }
  return { deleted: true, companyId, deletedByUserId: actor.id };
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
