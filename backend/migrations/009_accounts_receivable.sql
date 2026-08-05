-- A sale registered as "a prazo" is the source of truth for an account receivable.
-- The record is created in the database so no frontend or API client can skip it.
CREATE TABLE accounts_receivable (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 1000000000000),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT accounts_receivable_sale_same_organization_fk
    FOREIGN KEY (organization_id, sale_id)
    REFERENCES sales (organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT accounts_receivable_customer_same_organization_fk
    FOREIGN KEY (organization_id, customer_id)
    REFERENCES customers (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT accounts_receivable_payment_state_check CHECK (
    (status = 'pending' AND paid_at IS NULL)
    OR (status = 'paid' AND paid_at IS NOT NULL)
  ),
  UNIQUE (sale_id),
  UNIQUE (organization_id, id)
);

CREATE INDEX accounts_receivable_organization_due_date
  ON accounts_receivable (organization_id, due_date);
CREATE INDEX accounts_receivable_organization_status_due_date
  ON accounts_receivable (organization_id, status, due_date);
CREATE TRIGGER accounts_receivable_touch_updated_at
  BEFORE UPDATE ON accounts_receivable FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE OR REPLACE FUNCTION create_account_receivable_for_pending_sale()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_status = 'pending' THEN
    INSERT INTO accounts_receivable (
      organization_id,
      sale_id,
      customer_id,
      amount_cents,
      due_date
    ) VALUES (
      NEW.organization_id,
      NEW.id,
      NEW.customer_id,
      NEW.total_cents,
      NEW.due_date
    )
    ON CONFLICT (sale_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_create_account_receivable
  AFTER INSERT ON sales
  FOR EACH ROW EXECUTE FUNCTION create_account_receivable_for_pending_sale();

-- Also create records for any pending sales that existed before this migration.
INSERT INTO accounts_receivable (organization_id, sale_id, customer_id, amount_cents, due_date)
SELECT organization_id, id, customer_id, total_cents, due_date
  FROM sales
 WHERE payment_status = 'pending'
ON CONFLICT (sale_id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON TABLE accounts_receivable TO sev_tenant_api;

ALTER TABLE accounts_receivable ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_receivable FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_accounts_receivable_read ON accounts_receivable
  FOR SELECT TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());
CREATE POLICY tenant_accounts_receivable_create ON accounts_receivable
  FOR INSERT TO sev_tenant_api
  WITH CHECK (organization_id = sev_current_organization_id());
CREATE POLICY tenant_accounts_receivable_update ON accounts_receivable
  FOR UPDATE TO sev_tenant_api
  USING (organization_id = sev_current_organization_id())
  WITH CHECK (organization_id = sev_current_organization_id());

-- Receiving an account updates the linked sale, so it also needs an RLS-safe update path.
DROP POLICY IF EXISTS tenant_sales_update ON sales;
CREATE POLICY tenant_sales_update ON sales
  FOR UPDATE TO sev_tenant_api
  USING (organization_id = sev_current_organization_id())
  WITH CHECK (organization_id = sev_current_organization_id());
