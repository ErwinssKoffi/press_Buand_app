# Exemples curl — API `/api/v1` (phase 06)

Base locale : `http://127.0.0.1:8080`. Auth par cookie `eclat_session`.

```bash
# 1. Installation (état vierge uniquement) puis connexion
curl -c jar.txt -X POST http://127.0.0.1:8080/auth/setup \
  -H "Content-Type: application/json" -d '{"secret":"54321"}'          # 204
curl -c jar.txt -b jar.txt -X POST http://127.0.0.1:8080/auth/login \
  -H "Content-Type: application/json" -d '{"pinOrPassword":"54321"}'   # 200 + Set-Cookie

# 2. Paramétrage
curl -b jar.txt -X PUT http://127.0.0.1:8080/api/v1/settings \
  -H "Content-Type: application/json" -d '{
    "shopName":"Éclat Pressing Cocody","activityScope":"both","expressPercent":50,
    "pressingConfig":{"pricePerKgByMode":{"lavage_repassage":1500},"expressPercent":50},
    "loyaltyConfig":{"enabled":true,"fcfaPerPoint":1000,"rewardThresholdPoints":50,"rewardDiscountFCFA":2000}}'

# 3. Catalogue + zone + client + recharge (idempotente)
curl -b jar.txt -X POST http://127.0.0.1:8080/api/v1/catalog -H "Content-Type: application/json" \
  -d '{"id":"cat-chemise","name":"Chemise","category":"Habit","defaultMode":"lavage_repassage","priceFCFA":1000,"unit":"pièce"}'
curl -b jar.txt -X POST http://127.0.0.1:8080/api/v1/delivery-zones -H "Content-Type: application/json" \
  -d '{"id":"zone-cocody","commune":"Cocody","feeFCFA":1500,"pickupFeeFCFA":1000,"active":true}'
curl -b jar.txt -X POST http://127.0.0.1:8080/api/v1/clients -H "Content-Type: application/json" \
  -d '{"fullName":"Aya Koffi","phone":"0102030405","commune":"Cocody"}'
curl -b jar.txt -X POST http://127.0.0.1:8080/api/v1/clients/$CLIENT_ID/wallet/topups \
  -H "Content-Type: application/json" -H "Idempotency-Key: 0192-top-1" \
  -d '{"amountFCFA":20000,"method":"especes","note":"Recharge"}'       # 200 {client, walletHistory}

# 4. Aperçu tarifaire (aucune écriture)
curl -b jar.txt -X POST http://127.0.0.1:8080/api/v1/orders/mapping -H "Content-Type: application/json" \
  -d '{"clientId":"'$CLIENT_ID'","items":[{"catalogItemId":"cat-chemise","name":"Chemise","mode":"lavage_repassage","quantity":2,"unit":"pièce"}],"deliveryZoneId":"zone-cocody","usePrepaid":true}'
# → {"order":{...},"actualPrepaidUsedFCFA":3500,"cashDueFCFA":0,...}

# 5. Création de commande (Idempotency-Key requis, rejeu → 409)
curl -b jar.txt -X POST http://127.0.0.1:8080/api/v1/orders \
  -H "Content-Type: application/json" -H "Idempotency-Key: 0192-ord-1" \
  -d '{"clientId":"'$CLIENT_ID'","items":[{"catalogItemId":"cat-chemise","name":"Chemise","mode":"lavage_repassage","quantity":2,"unit":"pièce"}],"deliveryZoneId":"zone-cocody","usePrepaid":true,"initialPaymentMethod":"especes"}'
# → 201 {ticketNumber:"EP-2026-0001", totalFCFA:3500, prepaidUsedFCFA:3500, loyaltyPointsEarned:3, ...}

# 6. Acompte partiel puis solde complémentaire (anti-surpaiement)
curl -b jar.txt -X POST http://127.0.0.1:8080/api/v1/orders \
  -H "Content-Type: application/json" -H "Idempotency-Key: 0192-ord-2" \
  -d '{"clientId":"'$CLIENT_ID'","items":[{"catalogItemId":"cat-chemise","name":"Chemise","mode":"lavage_repassage","quantity":30,"unit":"pièce"}],"usePrepaid":true,"initialCashPaidFCFA":5000,"initialPaymentMethod":"wave"}'
curl -b jar.txt -X POST http://127.0.0.1:8080/api/v1/orders/$ORDER_ID/payments \
  -H "Content-Type: application/json" -H "Idempotency-Key: 0192-pay-1" \
  -d '{"amountFCFA":8500,"method":"wave"}'
# paiement excessif → 422 {"error":{"code":"business_rule","message":"paiement supérieur au solde restant"}}

# 7. Transitions + livraison logistique (même transaction)
curl -b jar.txt -X PATCH http://127.0.0.1:8080/api/v1/orders/$ORDER_ID/status \
  -H "Content-Type: application/json" -d '{}'                          # recu → lavage
curl -b jar.txt -X POST http://127.0.0.1:8080/api/v1/logistics -H "Content-Type: application/json" \
  -d '{"type":"livraison","status":"planifie","clientName":"Aya Koffi","commune":"Cocody","orderId":"'$ORDER_ID'","scheduledDate":"2026-11-28"}'
curl -b jar.txt -X PATCH http://127.0.0.1:8080/api/v1/logistics/$TASK_ID/status \
  -H "Content-Type: application/json" -d '{"status":"effectue"}'       # commande → livre

# 8. Stock : entrée avec dépense automatique (idempotente)
curl -b jar.txt -X POST http://127.0.0.1:8080/api/v1/inventory -H "Content-Type: application/json" \
  -d '{"id":"inv-lessive","name":"Lessive 5kg","category":"Produits","activityScope":"both","unit":"kg","quantity":2,"minThreshold":1,"unitCostFCFA":1500}'
curl -b jar.txt -X POST http://127.0.0.1:8080/api/v1/inventory/inv-lessive/movements \
  -H "Content-Type: application/json" -H "Idempotency-Key: 0192-mov-1" \
  -d '{"type":"entree","quantity":10,"unitCostFCFA":1800,"recordExpense":true,"paymentMethod":"especes"}'

# 9. Dépenses + Z de caisse + rapport mensuel
curl -b jar.txt -X POST http://127.0.0.1:8080/api/v1/expenses -H "Content-Type: application/json" \
  -d '{"label":"Lessive","category":"Produits & Lessive","amountFCFA":7500,"method":"especes","date":"2026-11-27"}'
curl -b jar.txt "http://127.0.0.1:8080/api/v1/reports/daily-z?date=2026-11-27"
curl -b jar.txt "http://127.0.0.1:8080/api/v1/reports/monthly?month=2026-11"

# 10. Bootstrap de démarrage (fenêtre 90 jours)
curl -b jar.txt "http://127.0.0.1:8080/api/v1/bootstrap?windowDays=90"

# 11. Export backup v3, preview puis restauration d'un backup legacy (Prompt 07)
#     Toujours : preview (aucune écriture) → lecture du rapport → restore confirmé.
curl -b jar.txt http://127.0.0.1:8080/api/v1/backup/export > serveur.json
curl -b jar.txt -X POST http://127.0.0.1:8080/api/v1/backup/preview \
  -H "Content-Type: application/json" --data-binary @eclat-backup-legacy.json
# sans confirmation → 400 invalid_request (deux étapes obligatoires)
curl -b jar.txt -X POST http://127.0.0.1:8080/api/v1/backup/restore \
  -H "Content-Type: application/json" --data-binary @eclat-backup-legacy.json
# confirmé → 200 {"status":"restauré","created":{…},"serverBackup":"…/pre-restore-….json"}
# re-import du même fichier → {"status":"déjà appliqué"} (hash SHA-256 idempotent)
curl -b jar.txt -X POST http://127.0.0.1:8080/api/v1/backup/restore \
  -H "Content-Type: application/json" -H "X-Backup-Confirm: true" \
  --data-binary @eclat-backup-legacy.json

# 12. Annulation non destructive
curl -b jar.txt -X POST http://127.0.0.1:8080/api/v1/orders/$ORDER_ID/void \
  -H "Content-Type: application/json" -d '{"reason":"erreur de saisie"}'
```

Codes utiles : `400 invalid_request` (validation, restore sans confirmation), `401 unauthorized`,
`404 not_found`, `409 conflict` (rejeu idempotent), `422 business_rule` (règles métier,
backup v3 invalide), `501 not_implemented` (sync → phase 09).
