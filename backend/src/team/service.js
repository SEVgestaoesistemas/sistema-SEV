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

    const baseUrl = config.allowedOrigins[0].replace(/\/$/, '');
    return { ...invitation, inviteLink: `${baseUrl}/#invite=${token}` };
  });
};

export const acceptInvitation = async (db, payload, config) => db.transaction(async transaction => {
  const invitationResult = await transaction.query(
    `SELECT id, organization_id, recipient_name, email, role
       FROM team_invitations
      WHERE token_hash = $1 AND expires_at > now() AND accepted_at IS NULL AND revoked_at IS NULL
      FOR UPDATE`,
    [hashSessionToken(payload.token)]
  );
  const invitation = invitationResult.rows[0];
  if (!invitation) {
    throw new AppError('Convite inválido ou expirado.', { statusCode: 400, code: 'INVALID_INVITATION' });
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
