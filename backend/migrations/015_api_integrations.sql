-- First-party API integrations for inventory and paid sales.
-- This migration is intentionally not applied automatically outside the normal migration runner.

CREATE TABLE organization_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  key_prefix TEXT NOT NULL CHECK (char_length(key_prefix) BETWEEN 8 AND 32),
  key_hash TEXT NOT NULL UNIQUE CHECK (char_length(key_hash) = 64),
  scopes TEXT[] NOT NULL CHECK (
    cardinality(scopes) > 0
    AND scopes <@ ARRAY['inventory:write', 'sales:write', 'sync-logs:read']::TEXT[]
  ),
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX organization_api_keys_organization_created
  ON organization_api_keys (organization_id, created_at DESC);
CREATE INDEX organization_api_keys_active
  ON organization_api_keys (organization_id) WHERE revoked_at IS NULL;

ALTER TABLE products ADD COLUMN external_id TEXT CHECK (external_id IS NULL OR char_length(external_id) BETWEEN 1 AND 128);
CREATE UNIQUE INDEX products_organization_external_id_unique
  ON products (organization_id, external_id) WHERE external_id IS NOT NULL;

ALTER TABLE customers ADD COLUMN external_id TEXT CHECK (external_id IS NULL OR char_length(external_id) BETWEEN 1 AND 128);
CREATE UNIQUE INDEX customers_organization_external_id_unique
  ON customers (organization_id, external_id) WHERE external_id IS NOT NULL;

ALTER TABLE sales
  ADD COLUMN external_id TEXT CHECK (external_id IS NULL OR char_length(external_id) BETWEEN 1 AND 128),
  ADD COLUMN api_key_id UUID REFERENCES organization_api_keys(id) ON DELETE SET NULL,
  ADD COLUMN external_payload_hash TEXT CHECK (external_payload_hash IS NULL OR char_length(external_payload_hash) = 64);
CREATE UNIQUE INDEX sales_organization_external_id_unique
  ON sales (organization_id, external_id) WHERE external_id IS NOT NULL;

ALTER TABLE stock_movements
  ADD COLUMN external_id TEXT CHECK (external_id IS NULL OR char_length(external_id) BETWEEN 1 AND 128),
  ADD COLUMN api_key_id UUID REFERENCES organization_api_keys(id) ON DELETE SET NULL,
  ADD COLUMN external_payload_hash TEXT CHECK (external_payload_hash IS NULL OR char_length(external_payload_hash) = 64),
  ADD COLUMN source_sale_id UUID,
  ADD CONSTRAINT stock_movements_source_sale_same_organization_fk
    FOREIGN KEY (organization_id, source_sale_id)
    REFERENCES sales (organization_id, id) ON DELETE CASCADE;
CREATE UNIQUE INDEX stock_movements_organization_external_id_unique
  ON stock_movements (organization_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE api_idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  api_key_id UUID NOT NULL REFERENCES organization_api_keys(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (char_length(operation) BETWEEN 3 AND 120),
  idempotency_key_hash TEXT NOT NULL CHECK (char_length(idempotency_key_hash) = 64),
  request_hash TEXT NOT NULL CHECK (char_length(request_hash) = 64),
  status_code INTEGER NOT NULL CHECK (status_code BETWEEN 200 AND 299),
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  UNIQUE (organization_id, api_key_id, operation, idempotency_key_hash)
);
CREATE INDEX api_idempotency_keys_expiration ON api_idempotency_keys (expires_at);

CREATE TABLE api_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  api_key_id UUID REFERENCES organization_api_keys(id) ON DELETE SET NULL,
  request_id UUID NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'PUT')),
  endpoint TEXT NOT NULL CHECK (char_length(endpoint) BETWEEN 1 AND 180),
  event_type TEXT NOT NULL CHECK (char_length(event_type) BETWEEN 2 AND 80),
  external_id TEXT CHECK (external_id IS NULL OR char_length(external_id) <= 128),
  status TEXT NOT NULL CHECK (status IN ('success', 'replayed', 'error')),
  http_status INTEGER NOT NULL CHECK (http_status BETWEEN 100 AND 599),
  error_code TEXT,
  payload_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_hash TEXT CHECK (payload_hash IS NULL OR char_length(payload_hash) = 64),
  source_ip INET,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX api_sync_logs_organization_created ON api_sync_logs (organization_id, created_at DESC);
CREATE INDEX api_sync_logs_key_created ON api_sync_logs (api_key_id, created_at DESC);

CREATE TABLE api_daily_usage (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0 AND request_count <= 1000000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, usage_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  organization_api_keys,
  api_idempotency_keys,
  api_sync_logs,
  api_daily_usage
TO sev_tenant_api;

GRANT DELETE ON TABLE sale_items TO sev_tenant_api;

ALTER TABLE organization_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_organization_api_keys_read ON organization_api_keys
  FOR SELECT TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());
CREATE POLICY tenant_organization_api_keys_create ON organization_api_keys
  FOR INSERT TO sev_tenant_api
  WITH CHECK (organization_id = sev_current_organization_id());
CREATE POLICY tenant_organization_api_keys_update ON organization_api_keys
  FOR UPDATE TO sev_tenant_api
  USING (organization_id = sev_current_organization_id())
  WITH CHECK (organization_id = sev_current_organization_id());

ALTER TABLE api_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_api_idempotency_keys_read ON api_idempotency_keys
  FOR SELECT TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());
CREATE POLICY tenant_api_idempotency_keys_create ON api_idempotency_keys
  FOR INSERT TO sev_tenant_api
  WITH CHECK (organization_id = sev_current_organization_id());
CREATE POLICY tenant_api_idempotency_keys_update ON api_idempotency_keys
  FOR UPDATE TO sev_tenant_api
  USING (organization_id = sev_current_organization_id())
  WITH CHECK (organization_id = sev_current_organization_id());

ALTER TABLE api_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_sync_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_api_sync_logs_read ON api_sync_logs
  FOR SELECT TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());
CREATE POLICY tenant_api_sync_logs_create ON api_sync_logs
  FOR INSERT TO sev_tenant_api
  WITH CHECK (organization_id = sev_current_organization_id());

ALTER TABLE api_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_daily_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_api_daily_usage_read ON api_daily_usage
  FOR SELECT TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());
CREATE POLICY tenant_api_daily_usage_create ON api_daily_usage
  FOR INSERT TO sev_tenant_api
  WITH CHECK (organization_id = sev_current_organization_id());
CREATE POLICY tenant_api_daily_usage_update ON api_daily_usage
  FOR UPDATE TO sev_tenant_api
  USING (organization_id = sev_current_organization_id())
  WITH CHECK (organization_id = sev_current_organization_id());

-- External sale corrections replace sale_items atomically under the tenant role.
CREATE POLICY tenant_sale_items_delete ON sale_items
  FOR DELETE TO sev_tenant_api
  USING (organization_id = sev_current_organization_id());
