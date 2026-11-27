-- 0002_seed : installation vierge uniquement (row singleton settings/credentials).
-- Les migrations ne réécrivent jamais une ligne existante (no-op si présente).

INSERT INTO shop_settings (
    id, shop_name, tagline, commune, address, phone, whatsapp_phone, rccm,
    ticket_footer_note, next_ticket_sequence, activity_scope,
    blanchisserie_config, pressing_config, loyalty_config, onboarding_completed
)
SELECT 1,
    'Éclat Pressing Abidjan',
    'Soin du linge · Nettoyage à sec · Blanchisserie',
    'Cocody — Angré 8e Tranche',
    'Boulevard Latrille, Immeuble Les Orchidées',
    '+225 07 48 22 19 04',
    '+225 07 48 22 19 04',
    'CI-ABJ-03-2024-B12-04821',
    'Tout article non retiré après 60 jours ne saurait engager la responsabilité du pressing. Merci pour votre fidélité.',
    1,
    'both',
    '{
        "enabledServices": {"lavage_simple": true, "lavage_repassage": true, "repassage_seul": true},
        "enableUnit": true,
        "unitPricesFCFA": {"lavage_simple": 500, "lavage_repassage": 800, "repassage_seul": 400},
        "packs": [
            {"id": "pack-10", "garmentCount": 10, "active": true,
             "pricesFCFA": {"lavage_simple": 1500, "lavage_repassage": 2000, "repassage_seul": 1200}},
            {"id": "pack-20", "garmentCount": 20, "active": true,
             "pricesFCFA": {"lavage_simple": 2800, "lavage_repassage": 3800, "repassage_seul": 2200}}
        ]
    }'::jsonb,
    '{
        "weightEnabled": true,
        "pricePerKgByMode": {
            "nettoyage_sec": 4000, "lavage_simple": 2500, "lavage_repassage": 3500,
            "repassage_seul": 2000, "blanchisserie": 2500
        },
        "weightOffers": [
            {"id": "wo-1", "label": "Forfait 1,5 kg (Lavage + Repassage)", "weightKg": 1.5,
             "mode": "lavage_repassage", "priceFCFA": 5000, "active": true},
            {"id": "wo-2", "label": "Forfait 3 kg (Lavage + Repassage)", "weightKg": 3,
             "mode": "lavage_repassage", "priceFCFA": 9000, "active": true},
            {"id": "wo-3", "label": "Forfait 2 kg (Nettoyage à sec)", "weightKg": 2,
             "mode": "nettoyage_sec", "priceFCFA": 7500, "active": true}
        ],
        "expressPricingMode": "fixed_per_piece",
        "expressFixedAmountFCFA": 1500,
        "expressPercent": 50
    }'::jsonb,
    '{"enabled": true, "fcfaPerPoint": 1000, "rewardThresholdPoints": 50, "rewardDiscountFCFA": 2000}'::jsonb,
    FALSE
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth_credentials (id, algo) SELECT 1, 'none' ON CONFLICT (id) DO NOTHING;

INSERT INTO ticket_counters (year, last_seq)
SELECT EXTRACT(YEAR FROM now())::int, 0
ON CONFLICT (year) DO NOTHING;
