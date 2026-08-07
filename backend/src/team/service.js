import { AppError } from '../errors.js';
import { recordAudit } from '../audit.js';
import { hashPassword } from '../security/password.js';
import { createSessionToken, hashSessionToken } from '../security/session.js';
import { createStoredSession } from '../auth/service.js';

const normalizeEmail = email => email.trim().toLowerCase();

export const createInvitation = async (db, payload, actor, config) => {
  const email = normalizeEmail(payload.email);
  if (actor.organization.role === 'admin' && payload.role === 'admin') {
    throw new AppError('Somente o proprietário pode convidar outro administrador.', { statusCode: 403, code: 'FORBIDDEN' });
  }

  return db.transaction(async transaction => {
    const member = await transaction.query(
      `SELECT membership.user_id
         FROM organization_memberships membership
         JOIN users u ON u.id = membership.user_id
        WHERE membership.organization_id = $1 AND u.email = $2`,
      [actor.organization.id, email]
    );
    if (member.rowCount) {
      throw new AppError('Esta pessoa já faz parte da equipe.', { statusCode: 409, code: 'MEMBER_EXISTS' });
    }

    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const result = await transaction.query(
      `INSERT INTO team_invitations (
         organization_id, recipient_name, email, role, token_hash, invited_by_user_id, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, recipient_name AS "name", email, role, expires_at AS "expiresAt"`,
      [actor.organization.id, payload.name.trim(), email, payload.role, hashSessionToken(token), actor.id, expiresAt]
    );
    const invitation = result.rows[0];
    await recordAudit(transaction, {
      organizationId: actor.organization.id,
      actorUserId: actor.id,
      action: 'team.invitation_created',
      entityType: 'team_invitation',
      entityId: invitation.id,
      metadata: { role: invitation.role }
    });

    const baseUrl = config.frontendUrl;
    return { ...invitation, inviteLink: `${baseUrl}/aceitar-convite.html#invite=${token}` };
  });
};

export const updateMemberRole = async (db, userId, role, actor) => db.transaction(async transaction => {
  const member = await transaction.query(
    `SELECT membership.user_id AS "userId", membership.role, u.name, u.email, u.avatar_url AS "avatarUrl", membership.created_at AS "createdAt"
       FROM organization_memberships membership
       JOIN users u ON u.id = membership.user_id
      WHERE membership.organization_id = $1 AND membership.user_id = $2
      FOR UPDATE OF membership`,
    [actor.organization.id, userId]
  );
  const current = member.rows[0];
  if (!current) {
    throw new AppError('Integrante não encontrado nesta empresa.', { statusCode: 404, code: 'MEMBER_NOT_FOUND' });
  }
  if (current.role === 'owner') {
    throw new AppError('A função do proprietário não pode ser alterada por esta tela.', { statusCode: 403, code: 'OWNER_ROLE_PROTECTED' });
  }
  if (actor.organization.role === 'admin' && (current.role === 'admin' || role === 'admin')) {
    throw new AppError('Somente o proprietário pode alterar permissões de administrador.', { statusCode: 403, code: 'FORBIDDEN' });
  }

  const result = await transaction.query(
    `UPDATE organization_memberships membership
        SET role = $3
       FROM users u
      WHERE membership.organization_id = $1 AND membership.user_id = $2 AND u.id = membership.user_id
      RETURNING u.id, u.name, u.email, u.avatar_url AS "avatarUrl", membership.role, 'active' AS status, membership.created_at AS "createdAt"`,
    [actor.organization.id, userId, role]
  );
  const updated = result.rows[0];
  await recordAudit(transaction, {
    organizationId: actor.organization.id,
    actorUserId: actor.id,
    action: 'team.member_role_updated',
    entityType: 'user',
    entityId: userId,
    metadata: { from: current.role, to: role }
  });
  return updated;
});

export const acceptInvitation = async (db, payload, config) => db.transaction(async transaction => {
  const invitationResult = await transaction.query(
    `SELECT invitation.id, invitation.organization_id, invitation.recipient_name, invitation.email, invitation.role,
            organization.plan_expires_at, organization.is_suspended,
            (organization.plan_expires_at IS NOT NULL AND organization.plan_expires_at < (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS plan_expired
       FROM team_invitations invitation
       JOIN organizations organization ON organization.id = invitation.organization_id
      WHERE token_hash = $1 AND expires_at > now() AND accepted_at IS NULL AND revoked_at IS NULL
      FOR UPDATE`,
    [hashSessionToken(payload.token)]
  );
  const invitation = invitationResult.rows[0];
  if (!invitation) {
    throw new AppError('Convite inválido ou expirado.', { statusCode: 400, code: 'INVALID_INVITATION' });
  }
  if (invitation.plan_expired) {
    throw new AppError('O plano desta empresa expirou. Entre em contato com a SEV para regularizar o acesso.', {
      statusCode: 403,
      code: 'PLAN_EXPIRED'
    });
  }
  if (invitation.is_suspended) {
    throw new AppError('O acesso desta empresa está suspenso. Entre em contato com a SEV para regularizar.', {
      statusCode: 403,
      code: 'COMPANY_SUSPENDED'
    });
  }

  const existingUser = await transaction.query('SELECT id FROM users WHERE email = $1', [invitation.email]);
  if (existingUser.rowCount) {
    throw new AppError('Este e-mail já possui uma conta. Entre em contato com o administrador para adicionar o acesso.', {
      statusCode: 409,
      code: 'ACCOUNT_EXISTS'
    });
  }

  const passwordHash = await hashPassword(payload.password);
  const user = await transaction.query(
    'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
    [payload.name.trim(), invitation.email, passwordHash]
  );
  await transaction.query(
    'INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, $3)',
    [invitation.organization_id, user.rows[0].id, invitation.role]
  );
  await transaction.query('UPDATE team_invitations SET accepted_at = now() WHERE id = $1', [invitation.id]);
  const organization = await transaction.query('SELECT id, name FROM organizations WHERE id = $1', [invitation.organization_id]);
  const session = await createStoredSession(transaction, {
    userId: user.rows[0].id,
    organizationId: invitation.organization_id,
    config
  });
  await recordAudit(transaction, {
    organizationId: invitation.organization_id,
    actorUserId: user.rows[0].id,
    action: 'team.invitation_accepted',
    entityType: 'user',
    entityId: user.rows[0].id,
    metadata: { role: invitation.role }
  });

  return {
    session,
    user: {
      id: user.rows[0].id,
      name: user.rows[0].name,
      email: user.rows[0].email,
      organization: { id: organization.rows[0].id, name: organization.rows[0].name, role: invitation.role }
    }
  };
});
