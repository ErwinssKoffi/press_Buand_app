// Package pressing porte les types métier purs d'Éclat Pressing :
// contrats JSON camelCase strictement compatibles avec src/types/pressing.ts.
package pressing

// OrderStatus — cycle atelier.
type OrderStatus string

const (
	StatusRecu      OrderStatus = "recu"
	StatusLavage    OrderStatus = "lavage"
	StatusRepassage OrderStatus = "repassage"
	StatusPret      OrderStatus = "pret"
	StatusLivre     OrderStatus = "livre"
)

// NextStatus renvoie la transition suivante (nil si terminal).
func (s OrderStatus) NextStatus() *OrderStatus {
	switch s {
	case StatusRecu:
		v := StatusLavage
		return &v
	case StatusLavage:
		v := StatusRepassage
		return &v
	case StatusRepassage:
		v := StatusPret
		return &v
	case StatusPret:
		v := StatusLivre
		return &v
	}
	return nil
}

// ValidStatus contrôle l'appartenance à l'union TS.
func ValidStatus(s string) bool {
	switch OrderStatus(s) {
	case StatusRecu, StatusLavage, StatusRepassage, StatusPret, StatusLivre:
		return true
	}
	return false
}

// PaymentMethod — moyens de règlement (unions TS conservées).
type PaymentMethod string

const (
	MethodEspeces     PaymentMethod = "especes"
	MethodWave        PaymentMethod = "wave"
	MethodOrangeMoney PaymentMethod = "orange_money"
	MethodMTNMomo     PaymentMethod = "mtn_momo"
	MethodMoovMoney   PaymentMethod = "moov_money"
)

func ValidPaymentMethod(s string) bool {
	switch PaymentMethod(s) {
	case MethodEspeces, MethodWave, MethodOrangeMoney, MethodMTNMomo, MethodMoovMoney:
		return true
	}
	return false
}

// ServiceMode — modes de traitement.
type ServiceMode string

const (
	ModeNettoyageSec    ServiceMode = "nettoyage_sec"
	ModeLavageSimple    ServiceMode = "lavage_simple"
	ModeLavageRepassage ServiceMode = "lavage_repassage"
	ModeRepassageSeul   ServiceMode = "repassage_seul"
	ModeBlanchisserie   ServiceMode = "blanchisserie"
)

func ValidServiceMode(s string) bool {
	switch ServiceMode(s) {
	case ModeNettoyageSec, ModeLavageSimple, ModeLavageRepassage, ModeRepassageSeul, ModeBlanchisserie:
		return true
	}
	return false
}

// LogisticsType / LogisticsStatus.
type LogisticsType string

const (
	LogisticsEnlevement LogisticsType = "enlevement"
	LogisticsLivraison  LogisticsType = "livraison"
)

type LogisticsStatus string

const (
	LogisticsPlanifie LogisticsStatus = "planifie"
	LogisticsEnCours  LogisticsStatus = "en_cours"
	LogisticsEffectue LogisticsStatus = "effectue"
	LogisticsAnnule   LogisticsStatus = "annule"
)

func ValidLogisticsStatus(s string) bool {
	switch LogisticsStatus(s) {
	case LogisticsPlanifie, LogisticsEnCours, LogisticsEffectue, LogisticsAnnule:
		return true
	}
	return false
}

func ValidLogisticsType(s string) bool {
	switch LogisticsType(s) {
	case LogisticsEnlevement, LogisticsLivraison:
		return true
	}
	return false
}

// InventoryMovementType.
type InventoryMovementType string

const (
	MovementEntree     InventoryMovementType = "entree"
	MovementSortie     InventoryMovementType = "sortie"
	MovementAjustement InventoryMovementType = "ajustement"
)

func ValidMovementType(s string) bool {
	switch InventoryMovementType(s) {
	case MovementEntree, MovementSortie, MovementAjustement:
		return true
	}
	return false
}

// ShopActivityScope.
type ShopActivityScope string

const (
	ScopeBoth          ShopActivityScope = "both"
	ScopePressing      ShopActivityScope = "pressing"
	ScopeBlanchisserie ShopActivityScope = "blanchisserie"
)

// BlanchisserieService.
type BlanchisserieService string

const (
	BServiceLavageSimple    BlanchisserieService = "lavage_simple"
	BServiceLavageRepassage BlanchisserieService = "lavage_repassage"
	BServiceRepassageSeul   BlanchisserieService = "repassage_seul"
)

// --- Configurations (JSONB) ---

type BlanchisseriePack struct {
	ID           string           `json:"id"`
	GarmentCount int              `json:"garmentCount"`
	Active       bool             `json:"active"`
	PricesFCFA   map[string]int64 `json:"pricesFCFA"`
}

type BlanchisserieConfig struct {
	EnabledServices map[string]bool     `json:"enabledServices"`
	EnableUnit      bool                `json:"enableUnit"`
	UnitPricesFCFA  map[string]int64    `json:"unitPricesFCFA"`
	Packs           []BlanchisseriePack `json:"packs"`
}

type PressingWeightOffer struct {
	ID        string      `json:"id"`
	Label     string      `json:"label"`
	WeightKg  float64     `json:"weightKg"`
	Mode      ServiceMode `json:"mode"`
	PriceFCFA int64       `json:"priceFCFA"`
	Active    bool        `json:"active"`
}

type ExpressPricingMode string

const (
	ExpressFixedPerPiece ExpressPricingMode = "fixed_per_piece"
	ExpressPercent       ExpressPricingMode = "percent"
)

type PressingConfig struct {
	WeightEnabled          bool                  `json:"weightEnabled"`
	PricePerKgByMode       map[string]int64      `json:"pricePerKgByMode"`
	WeightOffers           []PressingWeightOffer `json:"weightOffers"`
	ExpressPricingMode     ExpressPricingMode    `json:"expressPricingMode"`
	ExpressFixedAmountFCFA int64                 `json:"expressFixedAmountFCFA"`
	ExpressPercent         int64                 `json:"expressPercent"`
}

type LoyaltyConfig struct {
	Enabled               bool  `json:"enabled"`
	FcfaPerPoint          int64 `json:"fcfaPerPoint"`
	RewardThresholdPoints int64 `json:"rewardThresholdPoints"`
	RewardDiscountFCFA    int64 `json:"rewardDiscountFCFA"`
}

// PressingSettings : DTO public (jamais de hash/secret ici).
type PressingSettings struct {
	ID                  string              `json:"id"`
	ShopName            string              `json:"shopName"`
	Tagline             string              `json:"tagline"`
	Commune             string              `json:"commune"`
	Address             string              `json:"address"`
	Phone               string              `json:"phone"`
	WhatsappPhone       string              `json:"whatsappPhone"`
	Rccm                string              `json:"rccm"`
	ExpressPercent      int64               `json:"expressPercent"`
	TicketFooterNote    string              `json:"ticketFooterNote"`
	NextTicketSequence  int64               `json:"nextTicketSequence"`
	ActivityScope       ShopActivityScope   `json:"activityScope"`
	BlanchisserieConfig BlanchisserieConfig `json:"blanchisserieConfig"`
	PressingConfig      PressingConfig      `json:"pressingConfig"`
	LoyaltyConfig       LoyaltyConfig       `json:"loyaltyConfig"`
	OnboardingCompleted bool                `json:"onboardingCompleted"`
}

// --- Entités ---

type CatalogItem struct {
	ID             string      `json:"id"`
	Name           string      `json:"name"`
	Category       string      `json:"category"`
	DefaultMode    ServiceMode `json:"defaultMode"`
	PriceFCFA      int64       `json:"priceFCFA"`
	Unit           string      `json:"unit"` // pièce | kg | paire
	Active         bool        `json:"active"`
	ImageURL       *string     `json:"imageUrl"`
	TurnaroundDays *int        `json:"turnaroundDays"`
	CareNote       *string     `json:"careNote"`
	CreatedAt      string      `json:"createdAt,omitempty"`
	UpdatedAt      string      `json:"updatedAt,omitempty"`
}

type ClientWalletEntry struct {
	ID         string  `json:"id"`
	Date       string  `json:"date"`
	Type       string  `json:"type"` // recharge | utilisation | bonus
	AmountFCFA int64   `json:"amountFCFA"`
	Method     *string `json:"method"`
	Note       *string `json:"note"`
}

type Client struct {
	ID                    string              `json:"id"`
	FullName              string              `json:"fullName"`
	Phone                 string              `json:"phone"`
	Commune               string              `json:"commune"`
	AddressNote           *string             `json:"addressNote"`
	CreatedAt             string              `json:"createdAt"`
	LoyaltyPoints         int64               `json:"loyaltyPoints"`
	PrepaidBalanceFCFA    int64               `json:"prepaidBalanceFCFA"`
	SubscriptionLabel     *string             `json:"subscriptionLabel"`
	SubscriptionExpiresAt *string             `json:"subscriptionExpiresAt"`
	WalletHistory         []ClientWalletEntry `json:"walletHistory,omitempty"`
	Archived              bool                `json:"archived,omitempty"`
}

type OrderLineItem struct {
	ID             string      `json:"id"`
	CatalogItemID  *string     `json:"catalogItemId"`
	Name           string      `json:"name"`
	Mode           ServiceMode `json:"mode"`
	Quantity       float64     `json:"quantity"`
	Unit           string      `json:"unit"`
	UnitPriceFCFA  int64       `json:"unitPriceFCFA"`
	Note           *string     `json:"note"`
	ActivityType   *string     `json:"activityType"`
	PricingBasis   *string     `json:"pricingBasis"`
	PiecesPerUnit  *int        `json:"piecesPerUnit"`
	WeightKg       *float64    `json:"weightKg"`
	IsExpress      bool        `json:"isExpress"`
	ExpressFeeFCFA int64       `json:"expressFeeFCFA"`
	ExpressDueDate *string     `json:"expressDueDate"`
	LineTotalFCFA  int64       `json:"lineTotalFCFA,omitempty"`
}

type OrderClaimPhoto struct {
	ID         string  `json:"id"`
	Caption    string  `json:"caption"`
	ItemName   *string `json:"itemName"`
	CapturedAt string  `json:"capturedAt"`
	URL        string  `json:"url"`
}

type Order struct {
	ID                    string            `json:"id"`
	TicketNumber          string            `json:"ticketNumber"`
	TicketSeq             int64             `json:"-"`
	ClientID              *string           `json:"clientId"`
	ClientName            string            `json:"clientName"`
	ClientPhone           string            `json:"clientPhone"`
	Commune               string            `json:"commune"`
	RackSlot              string            `json:"rackSlot"`
	Items                 []OrderLineItem   `json:"items"`
	IsExpress             bool              `json:"isExpress"`
	ExpressFeeFCFA        int64             `json:"expressFeeFCFA"`
	DeliveryFeeFCFA       int64             `json:"deliveryFeeFCFA"`
	DiscountFCFA          int64             `json:"discountFCFA"`
	PrepaidUsedFCFA       int64             `json:"prepaidUsedFCFA"`
	LoyaltyPointsEarned   int64             `json:"loyaltyPointsEarned"`
	LoyaltyPointsRedeemed int64             `json:"loyaltyPointsRedeemed"`
	SubtotalFCFA          int64             `json:"subtotalFCFA"`
	TotalFCFA             int64             `json:"totalFCFA"`
	PaidFCFA              int64             `json:"paidFCFA"`
	Status                OrderStatus       `json:"status"`
	DropOffDate           string            `json:"dropOffDate"`
	DueDate               *string           `json:"dueDate"`
	DeliveredAt           *string           `json:"deliveredAt"`
	Notes                 *string           `json:"notes"`
	VoidedAt              *string           `json:"voidedAt"`
	VoidReason            *string           `json:"voidReason"`
	ClaimPhotos           []OrderClaimPhoto `json:"claimPhotos,omitempty"`
	CreatedAt             string            `json:"createdAt"`
	UpdatedAt             string            `json:"updatedAt"`
}

type PaymentRecord struct {
	ID           string        `json:"id"`
	OrderID      *string       `json:"orderId"`
	TicketNumber string        `json:"ticketNumber"`
	ClientName   string        `json:"clientName"`
	AmountFCFA   int64         `json:"amountFCFA"`
	Method       PaymentMethod `json:"method"`
	PaidAt       string        `json:"paidAt"`
	Type         string        `json:"type"` // acompte | solde | integral
	Kind         string        `json:"kind"` // order | prepaid_topup
}

type ExpenseRecord struct {
	ID         string        `json:"id"`
	Label      string        `json:"label"`
	Category   string        `json:"category"`
	AmountFCFA int64         `json:"amountFCFA"`
	Method     PaymentMethod `json:"method"`
	Date       string        `json:"date"`
	Note       *string       `json:"note"`
	CreatedAt  string        `json:"createdAt"`
}

type DeliveryZone struct {
	ID            string `json:"id"`
	Commune       string `json:"commune"`
	FeeFCFA       int64  `json:"feeFCFA"`
	PickupFeeFCFA int64  `json:"pickupFeeFCFA"`
	Active        bool   `json:"active"`
	CreatedAt     string `json:"createdAt,omitempty"`
	UpdatedAt     string `json:"updatedAt,omitempty"`
}

type LogisticsTask struct {
	ID              string          `json:"id"`
	Type            LogisticsType   `json:"type"`
	Status          LogisticsStatus `json:"status"`
	ClientID        *string         `json:"clientId"`
	ClientName      string          `json:"clientName"`
	ClientPhone     string          `json:"clientPhone"`
	Commune         string          `json:"commune"`
	AddressDetail   string          `json:"addressDetail"`
	OrderID         *string         `json:"orderId"`
	TicketNumber    *string         `json:"ticketNumber"`
	ScheduledDate   string          `json:"scheduledDate"`
	TimeSlot        string          `json:"timeSlot"`
	CourierName     string          `json:"courierName"`
	CourierPhone    *string         `json:"courierPhone"`
	EstimatedPieces *int            `json:"estimatedPieces"`
	FeeFCFA         int64           `json:"feeFCFA"`
	Notes           *string         `json:"notes"`
	CreatedAt       string          `json:"createdAt"`
	UpdatedAt       string          `json:"updatedAt"`
}

type InventoryItem struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	SKU           *string           `json:"sku"`
	Category      string            `json:"category"`
	ActivityScope ShopActivityScope `json:"activityScope"`
	Unit          string            `json:"unit"`
	Quantity      float64           `json:"quantity"`
	MinThreshold  float64           `json:"minThreshold"`
	UnitCostFCFA  int64             `json:"unitCostFCFA"`
	Supplier      *string           `json:"supplier"`
	Notes         *string           `json:"notes"`
	Archived      bool              `json:"archived,omitempty"`
	UpdatedAt     string            `json:"updatedAt"`
}

type InventoryMovement struct {
	ID            string                `json:"id"`
	ItemID        string                `json:"itemId"`
	ItemName      string                `json:"itemName"`
	Type          InventoryMovementType `json:"type"`
	QuantityDelta float64               `json:"quantityDelta"`
	PreviousQty   float64               `json:"previousQty"`
	NewQty        float64               `json:"newQty"`
	Unit          string                `json:"unit"`
	UnitCostFCFA  *int64                `json:"unitCostFCFA"`
	TotalCostFCFA *int64                `json:"totalCostFCFA"`
	Reason        string                `json:"reason"`
	CreatedAt     string                `json:"createdAt"`
}

// OrderFilter : filtres de listOrders partagés (service + repository).
type OrderFilter struct {
	Status   string
	ClientID string
	Search   string
	From     string
	To       string
	Page     int
	PageSize int
}

// DailyZ : Z de caisse (agrégats du jour).
type DailyZ struct {
	Date                string           `json:"date"`
	RevenueByMethod     map[string]int64 `json:"revenueByMethod"`
	RevenueOrder        int64            `json:"revenueOrder"`
	RevenuePrepaidTopup int64            `json:"revenuePrepaidTopup"`
	RevenueTotal        int64            `json:"revenueTotal"`
	ExpensesTotal       int64            `json:"expensesTotal"`
	ExpensesByCategory  map[string]int64 `json:"expensesByCategory"`
	NetCash             int64            `json:"netCash"`
	OrdersCount         int              `json:"ordersCount"`
}

// MonthlyReport : rapport mensuel (CA vs dépenses par jour).
type MonthlyReport struct {
	Month               string       `json:"month"`
	RevenueTotal        int64        `json:"revenueTotal"`
	RevenueOrder        int64        `json:"revenueOrder"`
	RevenuePrepaidTopup int64        `json:"revenuePrepaidTopup"`
	ExpensesTotal       int64        `json:"expensesTotal"`
	Net                 int64        `json:"net"`
	Days                []MonthlyDay `json:"days"`
}

type MonthlyDay struct {
	Date     string `json:"date"`
	Revenue  int64  `json:"revenue"`
	Expenses int64  `json:"expenses"`
}
