ALTER TABLE products
  ADD COLUMN unit_price_cents BIGINT NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0 AND unit_price_cents <= 1000000000000),
  ADD CONSTRAINT products_organization_id_id_unique UNIQUE (organization_id, id);

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_organization_product_fk
  FOREIGN KEY (organization_id, product_id)
  REFERENCES products (organization_id, id)
  ON DELETE CASCADE;

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 3 AND 140),
  document TEXT CHECK (document IS NULL OR document ~ '^[0-9]{11,14}$'),
  email TEXT CHECK (email IS NULL OR email = lower(email)),
  phone TEXT CHECK (phone IS NULL OR char_length(phone) BETWEEN 8 AND 24),
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 500),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX customers_organization_document_unique
  ON customers (organization_id, document)
  WHERE document IS NOT NULL;
CREATE INDEX customers_organization_name ON customers (organization_id, name);
CREATE TRIGGER customers_touch_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_number BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
  customer_id UUID NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('pix', 'card', 'cash', 'boleto', 'bank_transfer', 'other')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('paid', 'pending')),
  due_date DATE,
  total_cents BIGINT NOT NULL CHECK (total_cents > 0 AND total_cents <= 1000000000000),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sales_customer_same_organization_fk
    FOREIGN KEY (organization_id, customer_id)
    REFERENCES customers (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT sales_payment_due_date_check CHECK (
    (payment_status = 'paid' AND due_date IS NULL)
    OR (payment_status = 'pending' AND due_date IS NOT NULL)
  ),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, order_number)
);
CREATE INDEX sales_organization_created_at ON sales (organization_id, created_at DESC);
CREATE INDEX sales_organization_pending_due_date ON sales (organization_id, due_date) WHERE payment_status = 'pending';

CREATE TABLE sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL,
  product_id UUID NOT NULL,
  product_name TEXT NOT NULL CHECK (char_length(product_name) BETWEEN 3 AND 140),
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 100000000),
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents > 0 AND unit_price_cents <= 1000000000000),
  subtotal_cents BIGINT NOT NULL CHECK (subtotal_cents > 0 AND subtotal_cents <= 1000000000000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sale_items_sale_same_organization_fk
    FOREIGN KEY (organization_id, sale_id)
    REFERENCES sales (organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT sale_items_product_same_organization_fk
    FOREIGN KEY (organization_id, product_id)
    REFERENCES products (organization_id, id)
    ON DELETE RESTRICT
);
CREATE INDEX sale_items_sale ON sale_items (sale_id);

GRANT SELECT, INSERT, UPDATE ON TABLE customers, sales, sale_items TO sev_tenant_api;
GRANT USAGE, SELECT ON SEQUENCE sales_order_number_seq TO sev_tenant_api;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_customers_read ON customers
  FOR SELECT TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());
CREATE POLICY tenant_customers_create ON customers
  FOR INSERT TO sev_tenant_api
  WITH CHECK (organization_id = sev_current_organization_id());
CREATE POLICY tenant_customers_update ON customers
  FOR UPDATE TO sev_tenant_api
  USING (organization_id = sev_current_organization_id())
  WITH CHECK (organization_id = sev_current_organization_id());

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_sales_read ON sales
  FOR SELECT TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());
CREATE POLICY tenant_sales_create ON sales
  FOR INSERT TO sev_tenant_api
  WITH CHECK (organization_id = sev_current_organization_id());

ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_sale_items_read ON sale_items
  FOR SELECT TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());
CREATE POLICY tenant_sale_items_create ON sale_items
  FOR INSERT TO sev_tenant_api
  WITH CHECK (organization_id = sev_current_organization_id());
