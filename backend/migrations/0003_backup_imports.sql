-- 0003 : journal des imports de sauvegarde (idempotence / reprise après interruption)
CREATE TABLE IF NOT EXISTS backup_imports (
    hash TEXT PRIMARY KEY,
    version INT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('preview','restauré','échec')),
    report JSONB NOT NULL DEFAULT '{}'::jsonb,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revision BIGINT NOT NULL DEFAULT nextval('change_seq'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
