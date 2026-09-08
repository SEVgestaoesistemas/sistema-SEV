import { AppError } from '../errors.js';
import { recordAudit } from '../audit.js';

const toModule = row => ({
  id: row.id,
  slug: row.slug,
  name: row.nome,
  description: row.descricao,
  icon: row.icone,
  active: Boolean(row.ativo),
  activatedAt: row.ativadoEm || null
});

const companyById = async (db, companyId) => {
  const result = await db.query('SELECT id, name FROM organizations WHERE id = $1', [companyId]);
  if (!result.rowCount) {
    throw new AppError('Empresa não encontrada.', { statusCode: 404, code: 'COMPANY_NOT_FOUND' });
  }
  return result.rows[0];
};

export const listActiveModules = async tenantDb => {
  const result = await tenantDb.query(
    `SELECT modulo.id, modulo.slug, modulo.nome, modulo.descricao, modulo.icone,
            vinculo.ativo, vinculo.ativado_em AS "ativadoEm"
       FROM empresa_modulos vinculo
       JOIN modulos modulo ON modulo.id = vinculo.modulo_id
      WHERE vinculo.organization_id = sev_current_organization_id()
        AND vinculo.ativo = true
      ORDER BY CASE modulo.slug WHEN 'gestao' THEN 0 WHEN 'crm' THEN 1 ELSE 2 END`
  );
  return result.rows.map(toModule);
};

export const isModuleActive = async (tenantDb, slug) => {
  const result = await tenantDb.query(
    `SELECT 1
       FROM empresa_modulos vinculo
       JOIN modulos modulo ON modulo.id = vinculo.modulo_id
      WHERE vinculo.organization_id = sev_current_organization_id()
        AND modulo.slug = $1
        AND vinculo.ativo = true`,
    [slug]
  );
  return result.rowCount > 0;
};

export const listCompanyModules = async (db, companyId) => {
  const company = await companyById(db, companyId);
  const result = await db.query(
    `SELECT modulo.id, modulo.slug, modulo.nome, modulo.descricao, modulo.icone,
            COALESCE(vinculo.ativo, false) AS ativo,
            vinculo.ativado_em AS "ativadoEm"
       FROM modulos modulo
       LEFT JOIN empresa_modulos vinculo
         ON vinculo.modulo_id = modulo.id AND vinculo.organization_id = $1
      ORDER BY CASE modulo.slug WHEN 'gestao' THEN 0 WHEN 'crm' THEN 1 ELSE 2 END`,
    [companyId]
  );
  return { company, modules: result.rows.map(toModule) };
};

export const setCompanyModuleStatus = async (db, companyId, moduleId, active, actor) => db.transaction(async transaction => {
  const company = await companyById(transaction, companyId);
  const moduleResult = await transaction.query(
    'SELECT id, slug, nome, descricao, icone FROM modulos WHERE id = $1 FOR UPDATE',
    [moduleId]
  );
  if (!moduleResult.rowCount) {
    throw new AppError('Módulo não encontrado.', { statusCode: 404, code: 'MODULE_NOT_FOUND' });
  }

  const updated = await transaction.query(
    `INSERT INTO empresa_modulos (organization_id, modulo_id, ativo, ativado_em)
     VALUES ($1, $2, $3, CASE WHEN $3 THEN now() ELSE NULL END)
     ON CONFLICT (organization_id, modulo_id)
     DO UPDATE SET ativo = EXCLUDED.ativo,
                   ativado_em = CASE WHEN EXCLUDED.ativo THEN now() ELSE NULL END
     RETURNING ativo, ativado_em AS "ativadoEm"`,
    [companyId, moduleId, active]
  );
  const modulo = moduleResult.rows[0];
  const module = toModule({ ...modulo, ...updated.rows[0] });

  await recordAudit(transaction, {
    organizationId: companyId,
    actorUserId: actor.id,
    action: 'platform.company_module_updated',
    entityType: 'module',
    entityId: moduleId,
    metadata: { moduleSlug: module.slug, active: module.active }
  });

  return { company, module };
});
