-- Remove the discontinued training and assessments module and all of its data.

DROP TABLE IF EXISTS avaliacao_tentativas;
DROP TABLE IF EXISTS avaliacao_opcoes;
DROP TABLE IF EXISTS avaliacao_questoes;
DROP TABLE IF EXISTS avaliacoes;
DROP FUNCTION IF EXISTS touch_avaliacao_updated_at();

DELETE FROM empresa_modulos
WHERE modulo_id IN (SELECT id FROM modulos WHERE slug = 'avaliacoes');

DELETE FROM modulos WHERE slug = 'avaliacoes';

ALTER TABLE modulos DROP CONSTRAINT IF EXISTS modulos_slug_check;
ALTER TABLE modulos ADD CONSTRAINT modulos_slug_check CHECK (slug IN ('gestao', 'crm'));
