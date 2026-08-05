ALTER TABLE expenses
  ADD COLUMN invoice_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT expenses_invoice_items_array_check CHECK (jsonb_typeof(invoice_items) = 'array');
