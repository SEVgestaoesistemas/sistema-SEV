-- Training assessments, questions, alternatives and attempts.
-- Each table carries organization_id so tenant isolation remains enforceable by RLS.

CREATE TABLE avaliacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL CHECK (char_length(titulo) BETWEEN 3 AND 160),
  nota_minima SMALLINT NOT NULL DEFAULT 70 CHECK (nota_minima BETWEEN 0 AND 100),
  criado_por UUID REFERENCES users(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE INDEX avaliacoes_organization_created ON avaliacoes (organization_id, criado_em DESC);

CREATE TABLE avaliacao_questoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  avaliacao_id UUID NOT NULL,
  enunciado TEXT NOT NULL CHECK (char_length(enunciado) BETWEEN 3 AND 1000),
  ordem SMALLINT NOT NULL CHECK (ordem BETWEEN 1 AND 100),
  UNIQUE (organization_id, id),
  UNIQUE (avaliacao_id, ordem),
  FOREIGN KEY (organization_id, avaliacao_id)
    REFERENCES avaliacoes (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX avaliacao_questoes_assessment ON avaliacao_questoes (organization_id, avaliacao_id, ordem);

CREATE TABLE avaliacao_opcoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  questao_id UUID NOT NULL,
  texto TEXT NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 600),
  correta BOOLEAN NOT NULL DEFAULT false,
  ordem SMALLINT NOT NULL CHECK (ordem BETWEEN 1 AND 12),
  UNIQUE (questao_id, ordem),
  FOREIGN KEY (organization_id, questao_id)
    REFERENCES avaliacao_questoes (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX avaliacao_opcoes_question ON avaliacao_opcoes (organization_id, questao_id, ordem);

CREATE TABLE avaliacao_tentativas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  avaliacao_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acertos SMALLINT NOT NULL CHECK (acertos >= 0),
  total_questoes SMALLINT NOT NULL CHECK (total_questoes > 0),
  pct_acerto NUMERIC(5, 2) NOT NULL CHECK (pct_acerto BETWEEN 0 AND 100),
  aprovado BOOLEAN NOT NULL,
  respondido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (acertos <= total_questoes),
  FOREIGN KEY (organization_id, avaliacao_id)
    REFERENCES avaliacoes (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX avaliacao_tentativas_assessment ON avaliacao_tentativas (organization_id, avaliacao_id, respondido_em DESC);
CREATE INDEX avaliacao_tentativas_user ON avaliacao_tentativas (organization_id, user_id, respondido_em DESC);

CREATE OR REPLACE FUNCTION touch_avaliacao_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER avaliacoes_touch_updated_at
BEFORE UPDATE ON avaliacoes
FOR EACH ROW EXECUTE FUNCTION touch_avaliacao_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON avaliacoes, avaliacao_questoes, avaliacao_opcoes, avaliacao_tentativas TO sev_tenant_api;
REVOKE ALL ON avaliacoes, avaliacao_questoes, avaliacao_opcoes, avaliacao_tentativas FROM PUBLIC;

ALTER TABLE avaliacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE avaliacoes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_avaliacoes_access ON avaliacoes FOR ALL TO sev_tenant_api
  USING (organization_id = sev_current_organization_id())
  WITH CHECK (organization_id = sev_current_organization_id());

ALTER TABLE avaliacao_questoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE avaliacao_questoes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_avaliacao_questoes_access ON avaliacao_questoes FOR ALL TO sev_tenant_api
  USING (organization_id = sev_current_organization_id())
  WITH CHECK (organization_id = sev_current_organization_id());

ALTER TABLE avaliacao_opcoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE avaliacao_opcoes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_avaliacao_opcoes_access ON avaliacao_opcoes FOR ALL TO sev_tenant_api
  USING (organization_id = sev_current_organization_id())
  WITH CHECK (organization_id = sev_current_organization_id());

ALTER TABLE avaliacao_tentativas ENABLE ROW LEVEL SECURITY;
ALTER TABLE avaliacao_tentativas FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_avaliacao_tentativas_access ON avaliacao_tentativas FOR ALL TO sev_tenant_api
  USING (organization_id = sev_current_organization_id())
  WITH CHECK (organization_id = sev_current_organization_id());
