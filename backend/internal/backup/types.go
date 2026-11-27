// Package backup : import/export des sauvegardes legacy v3 (IndexedDB
// `eclat_pressing_ci_v1`) vers PostgreSQL — preview, restauration atomique
// idempotente, migration du PIN legacy.
package backup

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
)

// SchemaVersionV3 : version du format legacy (DatabaseBackup, src/types/pressing.ts).
const SchemaVersionV3 = 3

// MaxPhotoBytes : taille décodée maximale par photo (5 MiB).
const MaxPhotoBytes = 5 << 20

// LegacyBackup : miroir exact du format exporté par l'ancienne application
// (exportBackupJSON). Les champs optionnels correspondent aux propriétés
// facultatives réelles du modèle TypeScript.
type LegacyBackup struct {
	Version    int               `json:"version"`
	ExportedAt string            `json:"exportedAt"`
	Settings   LegacySettings    `json:"settings"`
	Clients    []LegacyClient    `json:"clients"`
	Catalog    []LegacyCatalog   `json:"catalog"`
	Orders     []LegacyOrder     `json:"orders"`
	Payments   []LegacyPayment   `json:"payments"`
	Expenses   []LegacyExpense   `json:"expenses"`
	Zones      []LegacyZone      `json:"zones,omitempty"`
	Logistics  []LegacyTask      `json:"logistics,omitempty"`
	Inventory  []LegacyInventory `json:"inventory,omitempty"`
	Movements  []LegacyMovement  `json:"inventoryMovements,omitempty"`
}

type LegacySettings struct {
	ID                  string          `json:"id"`
	ShopName            string          `json:"shopName"`
	Tagline             string          `json:"tagline"`
	Commune             string          `json:"commune"`
	Address             string          `json:"address"`
	Phone               string          `json:"phone"`
	WhatsappPhone       string          `json:"whatsappPhone"`
	Rccm                string          `json:"rccm"`
	ExpressPercent      float64         `json:"expressPercent"`
	TicketFooterNote    string          `json:"ticketFooterNote"`
	NextTicketSequence  float64         `json:"nextTicketSequence"`
	ActivityScope       string          `json:"activityScope"`
	BlanchisserieConfig json.RawMessage `json:"blanchisserieConfig"`
	PressingConfig      json.RawMessage `json:"pressingConfig"`
	LoyaltyConfig       json.RawMessage `json:"loyaltyConfig,omitempty"`
	PinHash             string          `json:"pinHash,omitempty"`
	PinSalt             string          `json:"pinSalt,omitempty"`
	OnboardingCompleted bool            `json:"onboardingCompleted,omitempty"`
}

type LegacyWalletEntry struct {
	ID         string  `json:"id"`
	Date       string  `json:"date"`
	Type       string  `json:"type"`
	AmountFCFA float64 `json:"amountFCFA"`
	Method     string  `json:"method,omitempty"`
	Note       string  `json:"note,omitempty"`
}

type LegacyClient struct {
	ID                    string              `json:"id"`
	FullName              string              `json:"fullName"`
	Phone                 string              `json:"phone"`
	Commune               string              `json:"commune"`
	AddressNote           string              `json:"addressNote,omitempty"`
	CreatedAt             string              `json:"createdAt"`
	LoyaltyPoints         *float64            `json:"loyaltyPoints,omitempty"`
	PrepaidBalanceFCFA    *float64            `json:"prepaidBalanceFCFA,omitempty"`
	SubscriptionLabel     string              `json:"subscriptionLabel,omitempty"`
	SubscriptionExpiresAt string              `json:"subscriptionExpiresAt,omitempty"`
	WalletHistory         []LegacyWalletEntry `json:"walletHistory,omitempty"`
}

type LegacyCatalog struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Category       string   `json:"category"`
	DefaultMode    string   `json:"defaultMode"`
	PriceFCFA      float64  `json:"priceFCFA"`
	Unit           string   `json:"unit"`
	Active         bool     `json:"active"`
	ImageURL       string   `json:"imageUrl,omitempty"`
	TurnaroundDays *float64 `json:"turnaroundDays,omitempty"`
	CareNote       string   `json:"careNote,omitempty"`
}

type LegacyLineItem struct {
	ID             string   `json:"id"`
	CatalogItemID  string   `json:"catalogItemId,omitempty"`
	Name           string   `json:"name"`
	Mode           string   `json:"mode"`
	Quantity       float64  `json:"quantity"`
	Unit           string   `json:"unit"`
	UnitPriceFCFA  float64  `json:"unitPriceFCFA"`
	Note           string   `json:"note,omitempty"`
	ActivityType   string   `json:"activityType,omitempty"`
	PricingBasis   string   `json:"pricingBasis,omitempty"`
	PiecesPerUnit  *float64 `json:"piecesPerUnit,omitempty"`
	WeightKg       *float64 `json:"weightKg,omitempty"`
	IsExpress      bool     `json:"isExpress,omitempty"`
	ExpressFeeFCFA float64  `json:"expressFeeFCFA,omitempty"`
	ExpressDueDate string   `json:"expressDueDate,omitempty"`
	LineTotalFCFA  float64  `json:"lineTotalFCFA,omitempty"`
}

type LegacyPhoto struct {
	ID         string `json:"id"`
	DataURL    string `json:"dataUrl"`
	Caption    string `json:"caption"`
	ItemName   string `json:"itemName,omitempty"`
	CapturedAt string `json:"capturedAt"`
}

type LegacyOrder struct {
	ID                    string           `json:"id"`
	TicketNumber          string           `json:"ticketNumber"`
	ClientID              string           `json:"clientId,omitempty"`
	ClientName            string           `json:"clientName"`
	ClientPhone           string           `json:"clientPhone"`
	Commune               string           `json:"commune"`
	RackSlot              string           `json:"rackSlot"`
	Items                 []LegacyLineItem `json:"items"`
	IsExpress             bool             `json:"isExpress"`
	ExpressFeeFCFA        float64          `json:"expressFeeFCFA"`
	DeliveryFeeFCFA       float64          `json:"deliveryFeeFCFA"`
	DiscountFCFA          float64          `json:"discountFCFA"`
	PrepaidUsedFCFA       float64          `json:"prepaidUsedFCFA,omitempty"`
	LoyaltyPointsEarned   float64          `json:"loyaltyPointsEarned,omitempty"`
	LoyaltyPointsRedeemed float64          `json:"loyaltyPointsRedeemed,omitempty"`
	ClaimPhotos           []LegacyPhoto    `json:"claimPhotos,omitempty"`
	TotalFCFA             float64          `json:"totalFCFA"`
	PaidFCFA              float64          `json:"paidFCFA"`
	Status                string           `json:"status"`
	DropOffDate           string           `json:"dropOffDate"`
	DueDate               string           `json:"dueDate"`
	DeliveredAt           string           `json:"deliveredAt,omitempty"`
	Notes                 string           `json:"notes,omitempty"`
	CreatedAt             string           `json:"createdAt"`
	UpdatedAt             string           `json:"updatedAt"`
}

type LegacyPayment struct {
	ID           string  `json:"id"`
	OrderID      string  `json:"orderId"`
	TicketNumber string  `json:"ticketNumber"`
	ClientName   string  `json:"clientName"`
	AmountFCFA   float64 `json:"amountFCFA"`
	Method       string  `json:"method"`
	PaidAt       string  `json:"paidAt"`
	Type         string  `json:"type"`
}

type LegacyExpense struct {
	ID         string  `json:"id"`
	Label      string  `json:"label"`
	Category   string  `json:"category"`
	AmountFCFA float64 `json:"amountFCFA"`
	Method     string  `json:"method"`
	Date       string  `json:"date"`
	Note       string  `json:"note,omitempty"`
	CreatedAt  string  `json:"createdAt"`
}

type LegacyZone struct {
	ID            string  `json:"id"`
	Commune       string  `json:"commune"`
	FeeFCFA       float64 `json:"feeFCFA"`
	PickupFeeFCFA float64 `json:"pickupFeeFCFA"`
	Active        bool    `json:"active"`
	CreatedAt     string  `json:"createdAt,omitempty"`
	UpdatedAt     string  `json:"updatedAt,omitempty"`
}

type LegacyTask struct {
	ID              string   `json:"id"`
	Type            string   `json:"type"`
	Status          string   `json:"status"`
	ClientID        string   `json:"clientId,omitempty"`
	ClientName      string   `json:"clientName"`
	ClientPhone     string   `json:"clientPhone"`
	Commune         string   `json:"commune"`
	AddressDetail   string   `json:"addressDetail"`
	OrderID         string   `json:"orderId,omitempty"`
	TicketNumber    string   `json:"ticketNumber,omitempty"`
	ScheduledDate   string   `json:"scheduledDate"`
	TimeSlot        string   `json:"timeSlot"`
	CourierName     string   `json:"courierName"`
	CourierPhone    string   `json:"courierPhone,omitempty"`
	EstimatedPieces *float64 `json:"estimatedPieces,omitempty"`
	FeeFCFA         float64  `json:"feeFCFA"`
	Notes           string   `json:"notes,omitempty"`
	CreatedAt       string   `json:"createdAt"`
	UpdatedAt       string   `json:"updatedAt"`
}

type LegacyInventory struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	SKU           string  `json:"sku,omitempty"`
	Category      string  `json:"category"`
	ActivityScope string  `json:"activityScope"`
	Unit          string  `json:"unit"`
	Quantity      float64 `json:"quantity"`
	MinThreshold  float64 `json:"minThreshold"`
	UnitCostFCFA  float64 `json:"unitCostFCFA"`
	Supplier      string  `json:"supplier,omitempty"`
	Notes         string  `json:"notes,omitempty"`
	Archived      bool    `json:"archived,omitempty"`
	CreatedAt     string  `json:"createdAt,omitempty"`
	UpdatedAt     string  `json:"updatedAt,omitempty"`
}

type LegacyMovement struct {
	ID            string  `json:"id"`
	ItemID        string  `json:"itemId"`
	ItemName      string  `json:"itemName"`
	Type          string  `json:"type"`
	QuantityDelta float64 `json:"quantityDelta"`
	PreviousQty   float64 `json:"previousQty"`
	NewQty        float64 `json:"newQty"`
	Unit          string  `json:"unit"`
	UnitCostFCFA  float64 `json:"unitCostFCFA,omitempty"`
	TotalCostFCFA float64 `json:"totalCostFCFA,omitempty"`
	Reason        string  `json:"reason"`
	CreatedAt     string  `json:"createdAt,omitempty"`
}

var (
	validOrderStatus   = map[string]bool{"recu": true, "lavage": true, "repassage": true, "pret": true, "livre": true}
	validPaymentMethod = map[string]bool{"especes": true, "wave": true, "orange_money": true, "mtn_momo": true, "moov_money": true}
	validServiceMode   = map[string]bool{"nettoyage_sec": true, "lavage_simple": true, "lavage_repassage": true, "repassage_seul": true, "blanchisserie": true}
	validPaymentType   = map[string]bool{"acompte": true, "solde": true, "integral": true}
	validWalletType    = map[string]bool{"recharge": true, "utilisation": true, "bonus": true}
	validMovementType  = map[string]bool{"entree": true, "sortie": true, "ajustement": true}
	validLogisticsType = map[string]bool{"enlevement": true, "livraison": true}
	validLogisticsSt   = map[string]bool{"planifie": true, "en_cours": true, "effectue": true, "annule": true}
	validScope         = map[string]bool{"both": true, "pressing": true, "blanchisserie": true}
	validUnit          = map[string]bool{"pièce": true, "kg": true, "paire": true, "lot": true}
	validPhotoMIME     = map[string]string{"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

	ticketRe = regexp.MustCompile(`^EP-(\d{4})-(\d+)$`)
)

// ParseError : erreur de validation avec champ ciblé.
type ParseError struct {
	Field  string
	Issues []string
}

func (e *ParseError) Error() string {
	return fmt.Sprintf("backup invalide (%s): %s", e.Field, strings.Join(e.Issues, "; "))
}

// Parse : validation stricte du JSON legacy v3.
// Retourne (backup, sha256 hex, error). Ne touche jamais à la base.
func Parse(raw []byte) (*LegacyBackup, string, error) {
	sum := sha256.Sum256(raw)
	hash := hex.EncodeToString(sum[:])
	if len(raw) > 100<<20 {
		return nil, hash, &ParseError{Field: "taille", Issues: []string{"backup > 100 Mo"}}
	}
	var b LegacyBackup
	if err := json.Unmarshal(raw, &b); err != nil {
		return nil, hash, &ParseError{Field: "json", Issues: []string{"JSON mal formé: " + err.Error()}}
	}
	issues := []string{}
	if b.Version != SchemaVersionV3 {
		issues = append(issues, fmt.Sprintf("version %d attendue 3", b.Version))
	}
	if _, err := timeParseRFC3339(b.ExportedAt); err != nil {
		issues = append(issues, "exportedAt invalide (RFC3339 attendu)")
	}
	if strings.TrimSpace(b.Settings.ShopName) == "" {
		issues = append(issues, "settings.shopName obligatoire")
	}
	if b.Settings.ActivityScope != "" && !validScope[b.Settings.ActivityScope] {
		issues = append(issues, "settings.activityScope invalide: "+b.Settings.ActivityScope)
	}
	if err := checkIDCollisions(&b); err != nil {
		return nil, hash, err
	}
	// validations par entité
	for i, c := range b.Catalog {
		if !validServiceMode[c.DefaultMode] {
			issues = append(issues, fmt.Sprintf("catalog[%d].defaultMode invalide: %s", i, c.DefaultMode))
		}
		if !validUnit[c.Unit] {
			issues = append(issues, fmt.Sprintf("catalog[%d].unit invalide: %s", i, c.Unit))
		}
		if err := checkAmount(c.PriceFCFA, fmt.Sprintf("catalog[%d].priceFCFA", i)); err != nil {
			issues = append(issues, err.Error())
		}
	}
	for i, c := range b.Clients {
		if strings.TrimSpace(c.FullName) == "" || strings.TrimSpace(c.Phone) == "" {
			issues = append(issues, fmt.Sprintf("clients[%d]: fullName et phone obligatoires", i))
		}
		if _, err := timeParseRFC3339(c.CreatedAt); err != nil {
			issues = append(issues, fmt.Sprintf("clients[%d].createdAt invalide", i))
		}
		for j, w := range c.WalletHistory {
			if !validWalletType[w.Type] {
				issues = append(issues, fmt.Sprintf("clients[%d].walletHistory[%d].type invalide: %s", i, j, w.Type))
			}
			if err := checkAmount(w.AmountFCFA, fmt.Sprintf("clients[%d].walletHistory[%d].amountFCFA", i, j)); err != nil {
				// les utilisations sont négatives : tolérées
				if w.AmountFCFA >= 0 {
					issues = append(issues, err.Error())
				}
			}
		}
	}
	for i, o := range b.Orders {
		if !validOrderStatus[o.Status] {
			issues = append(issues, fmt.Sprintf("orders[%d].status invalide: %s", i, o.Status))
		}
		if _, err := timeParseDate(o.DropOffDate); err != nil {
			issues = append(issues, fmt.Sprintf("orders[%d].dropOffDate invalide (YYYY-MM-DD): %s", i, o.DropOffDate))
		}
		if o.TotalFCFA < 0 || o.PaidFCFA < 0 || o.PaidFCFA > o.TotalFCFA {
			issues = append(issues, fmt.Sprintf("orders[%d]: paidFCFA (%v) doit être dans [0,totalFCFA (%v)]", i, o.PaidFCFA, o.TotalFCFA))
		}
		for j, it := range o.Items {
			if !validServiceMode[it.Mode] {
				issues = append(issues, fmt.Sprintf("orders[%d].items[%d].mode invalide: %s", i, j, it.Mode))
			}
			if it.Quantity <= 0 {
				issues = append(issues, fmt.Sprintf("orders[%d].items[%d].quantity invalide: %v", i, j, it.Quantity))
			}
			if !validUnit[it.Unit] {
				issues = append(issues, fmt.Sprintf("orders[%d].items[%d].unit invalide: %s", i, j, it.Unit))
			}
		}
		for j, ph := range o.ClaimPhotos {
			if err := validatePhoto(ph); err != nil {
				issues = append(issues, fmt.Sprintf("orders[%d].claimPhotos[%d]: %v", i, j, err))
			}
		}
	}
	for i, p := range b.Payments {
		if !validPaymentMethod[p.Method] {
			issues = append(issues, fmt.Sprintf("payments[%d].method invalide: %s", i, p.Method))
		}
		if !validPaymentType[p.Type] {
			issues = append(issues, fmt.Sprintf("payments[%d].type invalide: %s", i, p.Type))
		}
		if err := checkAmount(p.AmountFCFA, fmt.Sprintf("payments[%d].amountFCFA", i)); err != nil {
			issues = append(issues, err.Error())
		}
		if _, err := timeParseRFC3339(p.PaidAt); err != nil {
			issues = append(issues, fmt.Sprintf("payments[%d].paidAt invalide", i))
		}
	}
	for i, e := range b.Expenses {
		if !validPaymentMethod[e.Method] {
			issues = append(issues, fmt.Sprintf("expenses[%d].method invalide: %s", i, e.Method))
		}
		if err := checkAmount(e.AmountFCFA, fmt.Sprintf("expenses[%d].amountFCFA", i)); err != nil {
			issues = append(issues, err.Error())
		}
		if _, err := timeParseDate(e.Date); err != nil {
			issues = append(issues, fmt.Sprintf("expenses[%d].date invalide: %s", i, e.Date))
		}
	}
	for i, t := range b.Logistics {
		if !validLogisticsType[t.Type] || !validLogisticsSt[t.Status] {
			issues = append(issues, fmt.Sprintf("logistics[%d]: type/statut invalide (%s/%s)", i, t.Type, t.Status))
		}
	}
	for i, m := range b.Movements {
		if !validMovementType[m.Type] {
			issues = append(issues, fmt.Sprintf("inventoryMovements[%d].type invalide: %s", i, m.Type))
		}
	}
	if len(issues) > 0 {
		return nil, hash, &ParseError{Field: "contenu", Issues: issues}
	}
	return &b, hash, nil
}

// checkIDCollisions : IDs en doublon à l'intérieur du backup → rejet sans écrasement.
func checkIDCollisions(b *LegacyBackup) error {
	dups := []string{}
	seen := func(kind, id string, m map[string]bool) {
		if id == "" {
			return
		}
		if m[id] {
			dups = append(dups, kind+"#"+id)
		}
		m[id] = true
	}
	c := map[string]bool{}
	for _, x := range b.Catalog {
		seen("catalog", x.ID, c)
	}
	cl := map[string]bool{}
	for _, x := range b.Clients {
		seen("client", x.ID, cl)
		for _, w := range x.WalletHistory {
			seen("walletEntry", w.ID, cl)
		}
	}
	o := map[string]bool{}
	for _, x := range b.Orders {
		seen("order", x.ID, o)
		for _, it := range x.Items {
			seen("orderItem", it.ID, o)
		}
		for _, p := range x.ClaimPhotos {
			seen("photo", p.ID, o)
		}
	}
	p := map[string]bool{}
	for _, x := range b.Payments {
		seen("payment", x.ID, p)
	}
	e := map[string]bool{}
	for _, x := range b.Expenses {
		seen("expense", x.ID, e)
	}
	z := map[string]bool{}
	for _, x := range b.Zones {
		seen("zone", x.ID, z)
	}
	l := map[string]bool{}
	for _, x := range b.Logistics {
		seen("logistics", x.ID, l)
	}
	iv := map[string]bool{}
	for _, x := range b.Inventory {
		seen("inventory", x.ID, iv)
	}
	for _, x := range b.Movements {
		seen("movement", x.ID, iv)
	}
	if len(dups) > 0 {
		return &ParseError{Field: "ids", Issues: append([]string{"IDs en doublon (aucune écrasement arbitraire):"}, dups...)}
	}
	return nil
}

func checkAmount(v float64, field string) error {
	if v < 0 {
		return fmt.Errorf("%s négatif: %v", field, v)
	}
	if math.Abs(v-math.Round(v)) > 1e-9 {
		return fmt.Errorf("%s non entier FCFA: %v", field, v)
	}
	return nil
}

// validatePhoto : data URL uniquement, MIME autorisé, taille décodée bornée.
func validatePhoto(ph LegacyPhoto) error {
	if !strings.HasPrefix(ph.DataURL, "data:") {
		return fmt.Errorf("dataUrl non data: (refusé)")
	}
	meta := strings.SplitN(strings.TrimPrefix(ph.DataURL, "data:"), ";base64,", 2)
	if len(meta) != 2 {
		return fmt.Errorf("dataUrl sans base64")
	}
	mime := meta[0]
	ext, ok := validPhotoMIME[mime]
	_ = ext
	if !ok {
		return fmt.Errorf("MIME non autorisé: %s (jpeg/png/webp attendus)", mime)
	}
	data, err := base64.StdEncoding.DecodeString(meta[1])
	if err != nil {
		return fmt.Errorf("base64 invalide: %v", err)
	}
	if len(data) == 0 {
		return fmt.Errorf("photo vide")
	}
	if len(data) > MaxPhotoBytes {
		return fmt.Errorf("photo trop volumineuse: %d octets (max %d)", len(data), MaxPhotoBytes)
	}
	return nil
}

// photoBytes : décode une photo validée → (contenu, extension).
func photoBytes(ph LegacyPhoto) ([]byte, string, error) {
	meta := strings.SplitN(strings.TrimPrefix(ph.DataURL, "data:"), ";base64,", 2)
	data, err := base64.StdEncoding.DecodeString(meta[1])
	if err != nil {
		return nil, "", err
	}
	return data, validPhotoMIME[meta[0]], nil
}
