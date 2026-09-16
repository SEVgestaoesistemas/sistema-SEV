-- CRM pipeline, negotiations, tasks, timeline and proposal items.

CREATE TABLE crm_etapas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  nome TEXT NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 80),
  cor TEXT NOT NULL DEFAULT '#5B4EF2' CHECK (cor ~ '^#[0-9A-Fa-f]{6}$'),
  ordem SMALLINT NOT NULL CHECK (ordem BETWEEN 1 AND 100),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, nome),
  UNIQUE (organization_id, ordem)
);
CREATE INDEX crm_etapas_organization_order ON crm_etapas (organization_id, ordem);

CREATE TABLE crm_negociacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  etapa_id UUID NOT NULL,
  nome TEXT NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 160),
  valor_cents BIGINT NOT NULL DEFAULT 0 CHECK (valor_cents BETWEEN 0 AND 1000000000000),
  qualificacao TEXT CHECK (qualificacao IS NULL OR char_length(qualificacao) <= 240),
  fonte TEXT CHECK (fonte IS NULL OR char_length(fonte) <= 100),
  campanha TEXT CHECK (campanha IS NULL OR char_length(campanha) <= 140),
  responsavel_id UUID REFERENCES users(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, etapa_id) REFERENCES crm_etapas (organization_id, id)
);
CREATE INDEX crm_negociacoes_organization_stage ON crm_negociacoes (organization_id, etapa_id, criado_em DESC);
CREATE INDEX crm_negociacoes_organization_responsible ON crm_negociacoes (organization_id, responsavel_id);

CREATE TABLE crm_tarefas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  negociacao_id UUID NOT NULL,
  texto TEXT NOT NULL CHECK (char_length(texto) BETWEEN 2 AND 500),
  feita BOOLEAN NOT NULL DEFAULT false,
  prazo DATE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, negociacao_id) REFERENCES crm_negociacoes (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX crm_tarefas_negotiation ON crm_tarefas (organization_id, negociacao_id, feita, prazo);

CREATE TABLE crm_historico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  negociacao_id UUID NOT NULL,
  titulo TEXT NOT NULL CHECK (char_length(titulo) BETWEEN 2 AND 160),
  descricao TEXT CHECK (descricao IS NULL OR char_length(descricao) <= 1000),
  tipo TEXT NOT NULL CHECK (tipo IN ('mudanca_etapa', 'tarefa', 'manual')),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por UUID REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, negociacao_id) REFERENCES crm_negociacoes (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX crm_historico_negotiation ON crm_historico (organization_id, negociacao_id, criado_em DESC);

CREATE TABLE crm_propostas_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  negociacao_id UUID NOT NULL,
  nome_produto TEXT NOT NULL CHECK (char_length(nome_produto) BETWEEN 2 AND 160),
  quantidade INTEGER NOT NULL CHECK (quantidade BETWEEN 1 AND 100000000),
  preco_cents BIGINT NOT NULL CHECK (preco_cents BETWEEN 0 AND 1000000000000),
  FOREIGN KEY (organization_id, negociacao_id) REFERENCES crm_negociacoes (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX crm_propostas_items_negotiation ON crm_propostas_itens (organization_id, negociacao_id);

CREATE OR REPLACE FUNCTION touch_crm_negociacao_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER crm_negociacoes_touch_updated_at
BEFORE UPDATE ON crm_negociacoes
FOR EACH ROW EXECUTE FUNCTION touch_crm_negociacao_updated_at();

CREATE OR REPLACE FUNCTION sev_seed_default_crm_stages()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.ativo AND EXISTS (SELECT 1 FROM modulos WHERE id = NEW.modulo_id AND slug = 'crm') THEN
    INSERT INTO crm_etapas (organization_id, nome, cor, ordem) VALUES
      (NEW.organization_id, 'Novo lead', '#5B4EF2', 1),
      (NEW.organization_id, 'Qualificação', '#2596BE', 2),
      (NEW.organization_id, 'Proposta enviada', '#E88A1B', 3),
      (NEW.organization_id, 'Em negociação', '#7B61FF', 4),
      (NEW.organization_id, 'Ganho', '#12A96B', 5),
      (NEW.organization_id, 'Perdido', '#D95050', 6)
    ON CONFLICT (organization_id, nome) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER empresa_modulos_seed_crm_stages
AFTER INSERT OR UPDATE OF ativo ON empresa_modulos
FOR EACH ROW EXECUTE FUNCTION sev_seed_default_crm_stages();

-- Existing customers that already have CRM enabled also receive the initial pipeline.
INSERT INTO crm_etapas (organization_id, nome, cor, ordem)
SELECT vinculo.organization_id, seed.nome, seed.cor, seed.ordem
  FROM empresa_modulos vinculo
  JOIN modulos modulo ON modulo.id = vinculo.modulo_id AND modulo.slug = 'crm'
 CROSS JOIN (VALUES
   ('Novo lead', '#5B4EF2', 1), ('Qualificação', '#2596BE', 2), ('Proposta enviada', '#E88A1B', 3),
   ('Em negociação', '#7B61FF', 4), ('Ganho', '#12A96B', 5), ('Perdido', '#D95050', 6)
 ) AS seed(nome, cor, ordem)
 WHERE vinculo.ativo = true
ON CONFLICT (organization_id, nome) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON crm_etapas, crm_negociacoes, crm_tarefas, crm_historico, crm_propostas_itens TO sev_tenant_api;
REVOKE ALL ON crm_etapas, crm_negociacoes, crm_tarefas, crm_historico, crm_propostas_itens FROM PUBLIC;
REVOKE ALL ON FUNCTION sev_seed_default_crm_stages() FROM PUBLIC;

ALTER TABLE crm_etapas ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_etapas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_crm_etapas_access ON crm_etapas FOR ALL TO sev_tenant_api
  USING (organization_id = sev_current_organization_id()) WITH CHECK (organization_id = sev_current_organization_id());
ALTER TABLE crm_negociacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_negociacoes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_crm_negociacoes_access ON crm_negociacoes FOR ALL TO sev_tenant_api
  USING (organization_id = sev_current_organization_id()) WITH CHECK (organization_id = sev_current_organization_id());
ALTER TABLE crm_tarefas ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_tarefas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_crm_tarefas_access ON crm_tarefas FOR ALL TO sev_tenant_api
  USING (organization_id = sev_current_organization_id()) WITH CHECK (organization_id = sev_current_organization_id());
ALTER TABLE crm_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_historico FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_crm_historico_access ON crm_historico FOR ALL TO sev_tenant_api
  USING (organization_id = sev_current_organization_id()) WITH CHECK (organization_id = sev_current_organization_id());
ALTER TABLE crm_propostas_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_propostas_itens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_crm_propostas_itens_access ON crm_propostas_itens FOR ALL TO sev_tenant_api
  USING (organization_id = sev_current_organization_id()) WITH CHECK (organization_id = sev_current_organization_id());
