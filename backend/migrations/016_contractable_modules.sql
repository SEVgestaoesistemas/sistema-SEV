-- Contractable modules for each customer organization.
-- The catalog is fixed in this first version; platform administrators manage activation.

CREATE TABLE modulos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE CHECK (slug IN ('gestao', 'crm', 'avaliacoes')),
  nome TEXT NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 80),
  descricao TEXT NOT NULL CHECK (char_length(descricao) BETWEEN 2 AND 240),
  icone TEXT NOT NULL CHECK (char_length(icone) BETWEEN 1 AND 48)
);

INSERT INTO modulos (slug, nome, descricao, icone) VALUES
  ('gestao', 'Gestão', 'Estoque, vendas, financeiro, relatórios e equipe.', 'chart'),
  ('crm', 'CRM', 'Funil de negociações, tarefas e propostas comerciais.', 'target'),
  ('avaliacoes', 'Avaliações', 'Treinamentos e avaliações para a equipe.', 'clipboard');

CREATE TABLE empresa_modulos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  modulo_id UUID NOT NULL REFERENCES modulos(id) ON DELETE RESTRICT,
  ativo BOOLEAN NOT NULL DEFAULT false,
  ativado_em TIMESTAMPTZ,
  UNIQUE (organization_id, modulo_id),
  CHECK ((ativo AND ativado_em IS NOT NULL) OR (NOT ativo AND ativado_em IS NULL))
);

CREATE INDEX empresa_modulos_organization_active
  ON empresa_modulos (organization_id, ativo);

-- Every existing company receives every catalog entry. Only Gestão is active by default.
INSERT INTO empresa_modulos (organization_id, modulo_id, ativo, ativado_em)
SELECT organization.id, modulo.id, modulo.slug = 'gestao',
       CASE WHEN modulo.slug = 'gestao' THEN now() ELSE NULL END
  FROM organizations organization
 CROSS JOIN modulos modulo
ON CONFLICT (organization_id, modulo_id) DO NOTHING;

CREATE OR REPLACE FUNCTION sev_seed_default_modules_for_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO empresa_modulos (organization_id, modulo_id, ativo, ativado_em)
  SELECT NEW.id, modulo.id, modulo.slug = 'gestao',
         CASE WHEN modulo.slug = 'gestao' THEN now() ELSE NULL END
    FROM modulos modulo
  ON CONFLICT (organization_id, modulo_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_seed_default_modules
AFTER INSERT ON organizations
FOR EACH ROW EXECUTE FUNCTION sev_seed_default_modules_for_organization();

REVOKE ALL ON FUNCTION sev_seed_default_modules_for_organization() FROM PUBLIC;
GRANT SELECT ON TABLE modulos, empresa_modulos TO sev_tenant_api;
REVOKE ALL ON TABLE modulos, empresa_modulos FROM PUBLIC;

ALTER TABLE modulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE modulos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_modulos_read ON modulos
  FOR SELECT TO sev_tenant_api
  USING (true);

ALTER TABLE empresa_modulos ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresa_modulos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_empresa_modulos_read ON empresa_modulos
  FOR SELECT TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());
