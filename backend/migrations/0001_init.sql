-- FCFA = BIGINT entiers ; quantités = NUMERIC(12,2) ; horodatages = TIMESTAMPTZ.

CREATE SEQUENCE IF NOT EXISTS change_seq;

CREATE TABLE ticket_counters (
    year INT PRIMARY KEY,
    last_seq BIGINT NOT NULL
);

CREATE TABLE shop_settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    shop_name TEXT NOT NULL,
    tagline TEXT NOT NULL DEFAULT '',
    commune TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    whatsapp_phone TEXT NOT NULL DEFAULT '',
    rccm TEXT NOT NULL DEFAULT '',
    ticket_footer_note TEXT NOT NULL DEFAULT '',
    next_ticket_sequence BIGINT NOT NULL DEFAULT 1,
    activity_scope TEXT NOT NULL DEFAULT 'both'
        CHECK (activity_scope IN ('both','pressing','blanchisserie')),
    blanchisserie_config JSONB NOT NULL,
    pressing_config JSONB NOT NULL,
    loyalty_config JSONB NOT NULL,
    onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
    revision BIGINT NOT NULL DEFAULT nextval('change_seq'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_credentials (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    algo TEXT NOT NULL DEFAULT 'none' CHECK (algo IN ('none','argon2id')),
    password_hash TEXT,
    legacy_hash TEXT,
    legacy_salt TEXT,
    failed_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    device_id TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_auth_sessions_expiry ON auth_sessions (expires_at);

CREATE TABLE catalog_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    default_mode TEXT NOT NULL,
    price_fcfa BIGINT NOT NULL CHECK (price_fcfa >= 0),
    unit TEXT NOT NULL CHECK (unit IN ('pièce','kg','paire')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    image_url TEXT,
    turnaround_days INT,
    care_note TEXT,
    revision BIGINT NOT NULL DEFAULT nextval('change_seq'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_catalog_category ON catalog_items (category, name);

CREATE TABLE clients (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    commune TEXT NOT NULL DEFAULT '',
    address_note TEXT,
    loyalty_points INT NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
    prepaid_balance_fcfa BIGINT NOT NULL DEFAULT 0 CHECK (prepaid_balance_fcfa >= 0),
    subscription_label TEXT,
    subscription_expires_at DATE,
    archived_at TIMESTAMPTZ,
    revision BIGINT NOT NULL DEFAULT nextval('change_seq'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clients_name ON clients (full_name);
CREATE INDEX idx_clients_archived ON clients (archived_at);

CREATE TABLE client_wallet_entries (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    entry_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    type TEXT NOT NULL CHECK (type IN ('recharge','utilisation','bonus')),
    amount_fcfa BIGINT NOT NULL,
    method TEXT,
    note TEXT
);
CREATE INDEX idx_wallet_client ON client_wallet_entries (client_id, entry_date DESC);

CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    ticket_number TEXT NOT NULL UNIQUE,
    ticket_seq BIGINT NOT NULL,
    client_id TEXT REFERENCES clients(id),
    client_name TEXT NOT NULL,
    client_phone TEXT NOT NULL,
    commune TEXT NOT NULL DEFAULT '',
    rack_slot TEXT NOT NULL DEFAULT '',
    subtotal_fcfa BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_fcfa >= 0),
    express_fee_fcfa BIGINT NOT NULL DEFAULT 0 CHECK (express_fee_fcfa >= 0),
    delivery_fee_fcfa BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_fcfa >= 0),
    discount_fcfa BIGINT NOT NULL DEFAULT 0 CHECK (discount_fcfa >= 0),
    prepaid_used_fcfa BIGINT NOT NULL DEFAULT 0 CHECK (prepaid_used_fcfa >= 0),
    loyalty_points_earned INT NOT NULL DEFAULT 0 CHECK (loyalty_points_earned >= 0),
    loyalty_points_redeemed INT NOT NULL DEFAULT 0 CHECK (loyalty_points_redeemed >= 0),
    total_fcfa BIGINT NOT NULL CHECK (total_fcfa >= 0),
    paid_fcfa BIGINT NOT NULL DEFAULT 0 CHECK (paid_fcfa >= 0 AND paid_fcfa <= total_fcfa),
    status TEXT NOT NULL
        CHECK (status IN ('recu','lavage','repassage','pret','livre')),
    drop_off_date DATE NOT NULL,
    due_date DATE,
    delivered_at TIMESTAMPTZ,
    notes TEXT,
    is_express BOOLEAN NOT NULL DEFAULT FALSE,
    voided_at TIMESTAMPTZ,
    void_reason TEXT,
    revision BIGINT NOT NULL DEFAULT nextval('change_seq'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_created ON orders (created_at DESC);
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_client ON orders (client_id);
CREATE INDEX idx_orders_voided ON orders (voided_at);

CREATE TABLE order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    catalog_item_id TEXT REFERENCES catalog_items(id),
    name TEXT NOT NULL,
    mode TEXT NOT NULL,
    quantity NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
    unit TEXT NOT NULL,
    unit_price_fcfa BIGINT NOT NULL CHECK (unit_price_fcfa >= 0),
    line_total_fcfa BIGINT NOT NULL DEFAULT 0 CHECK (line_total_fcfa >= 0),
    note TEXT,
    activity_type TEXT,
    pricing_basis TEXT,
    pieces_per_unit INT,
    weight_kg NUMERIC(10,2),
    is_express BOOLEAN NOT NULL DEFAULT FALSE,
    express_fee_fcfa BIGINT NOT NULL DEFAULT 0 CHECK (express_fee_fcfa >= 0),
    express_due_date DATE
);
CREATE INDEX idx_order_items_order ON order_items (order_id);

CREATE TABLE order_claim_photos (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    caption TEXT NOT NULL DEFAULT '',
    item_name TEXT,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    mime TEXT NOT NULL DEFAULT 'image/jpeg',
    size_bytes INT NOT NULL DEFAULT 0,
    storage_path TEXT NOT NULL
);
CREATE INDEX idx_claim_photos_order ON order_claim_photos (order_id);

CREATE TABLE payments (
    id TEXT PRIMARY KEY,
    order_id TEXT REFERENCES orders(id),
    ticket_number TEXT NOT NULL,
    client_name TEXT NOT NULL,
    amount_fcfa BIGINT NOT NULL CHECK (amount_fcfa > 0),
    method TEXT NOT NULL
        CHECK (method IN ('especes','wave','orange_money','mtn_momo','moov_money')),
    paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    type TEXT NOT NULL CHECK (type IN ('acompte','solde','integral')),
    kind TEXT NOT NULL DEFAULT 'order' CHECK (kind IN ('order','prepaid_topup')),
    idempotency_key TEXT UNIQUE,
    revision BIGINT NOT NULL DEFAULT nextval('change_seq'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_paid_at ON payments (paid_at DESC);
CREATE INDEX idx_payments_order ON payments (order_id);
CREATE INDEX idx_payments_kind_date ON payments (kind, paid_at);

CREATE TABLE expenses (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    category TEXT NOT NULL,
    amount_fcfa BIGINT NOT NULL CHECK (amount_fcfa > 0),
    method TEXT NOT NULL
        CHECK (method IN ('especes','wave','orange_money','mtn_momo','moov_money')),
    expense_date DATE NOT NULL,
    note TEXT,
    deleted_at TIMESTAMPTZ,
    revision BIGINT NOT NULL DEFAULT nextval('change_seq'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_date ON expenses (expense_date DESC, deleted_at);

CREATE TABLE delivery_zones (
    id TEXT PRIMARY KEY,
    commune TEXT NOT NULL,
    fee_fcfa BIGINT NOT NULL CHECK (fee_fcfa >= 0),
    pickup_fee_fcfa BIGINT NOT NULL DEFAULT 0 CHECK (pickup_fee_fcfa >= 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    revision BIGINT NOT NULL DEFAULT nextval('change_seq'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE logistics_tasks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('enlevement','livraison')),
    status TEXT NOT NULL
        CHECK (status IN ('planifie','en_cours','effectue','annule')),
    client_id TEXT REFERENCES clients(id),
    client_name TEXT NOT NULL,
    client_phone TEXT NOT NULL,
    commune TEXT NOT NULL DEFAULT '',
    address_detail TEXT NOT NULL DEFAULT '',
    order_id TEXT REFERENCES orders(id),
    ticket_number TEXT,
    scheduled_date DATE NOT NULL,
    time_slot TEXT NOT NULL DEFAULT '',
    courier_name TEXT NOT NULL DEFAULT '',
    courier_phone TEXT,
    estimated_pieces INT,
    fee_fcfa BIGINT NOT NULL DEFAULT 0 CHECK (fee_fcfa >= 0),
    notes TEXT,
    revision BIGINT NOT NULL DEFAULT nextval('change_seq'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_logistics_date ON logistics_tasks (scheduled_date, status);
CREATE INDEX idx_logistics_order ON logistics_tasks (order_id);

CREATE TABLE inventory_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sku TEXT,
    category TEXT NOT NULL,
    activity_scope TEXT NOT NULL DEFAULT 'both'
        CHECK (activity_scope IN ('both','pressing','blanchisserie')),
    unit TEXT NOT NULL,
    quantity NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    min_threshold NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_threshold >= 0),
    unit_cost_fcfa BIGINT NOT NULL DEFAULT 0 CHECK (unit_cost_fcfa >= 0),
    supplier TEXT,
    notes TEXT,
    archived_at TIMESTAMPTZ,
    revision BIGINT NOT NULL DEFAULT nextval('change_seq'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_inventory_category ON inventory_items (category, name);

CREATE TABLE inventory_movements (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES inventory_items(id),
    item_name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('entree','sortie','ajustement')),
    quantity_delta NUMERIC(12,2) NOT NULL,
    previous_qty NUMERIC(12,2) NOT NULL,
    new_qty NUMERIC(12,2) NOT NULL CHECK (new_qty >= 0),
    unit TEXT NOT NULL,
    unit_cost_fcfa BIGINT,
    total_cost_fcfa BIGINT,
    reason TEXT NOT NULL DEFAULT '',
    revision BIGINT NOT NULL DEFAULT nextval('change_seq'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_movements_item ON inventory_movements (item_id, created_at DESC);

CREATE TABLE devices (
    device_id TEXT PRIMARY KEY,
    label TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ,
    last_pull_revision BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE sync_operations (
    id UUID PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(device_id),
    operation_id UUID NOT NULL,
    op_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'accepted'
        CHECK (status IN ('accepted','duplicate','conflict','rejected')),
    payload JSONB NOT NULL,
    result JSONB,
    error_code TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_at TIMESTAMPTZ,
    UNIQUE (device_id, operation_id)
);
CREATE INDEX idx_sync_ops_device ON sync_operations (device_id, received_at DESC);

CREATE TABLE idempotency_keys (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    request_hash TEXT,
    response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, key)
);

CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor TEXT NOT NULL DEFAULT 'operator',
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_logs (created_at DESC);
