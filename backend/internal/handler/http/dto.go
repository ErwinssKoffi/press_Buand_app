package http

import (
	"github.com/erwinsskoffi/press_backend/internal/domain/pressing"
	"github.com/erwinsskoffi/press_backend/internal/service"
)

// MappingRequest : brouillon de dépôt (contrat §4) — aperçu /orders/mapping
// et création POST /orders. Les montants restent indicatifs : le serveur
// recalcule tout.
type MappingRequest struct {
	IdempotencyKey string                   `json:"idempotencyKey,omitempty"`
	ClientID       *string                  `json:"clientId"`
	NewClient      *pressing.Client         `json:"newClient"`
	ClientName     string                   `json:"clientName"`
	ClientPhone    string                   `json:"clientPhone"`
	Commune        string                   `json:"commune"`
	RackSlot       string                   `json:"rackSlot"`
	Items          []pressing.OrderLineItem `json:"items"`
	IsExpress      bool                     `json:"isExpress"`
	DeliveryZoneID *string                  `json:"deliveryZoneId"`
	// DeliveryFeeFCFA ignoré : recalculé depuis la zone validée (ADR A13).
	DeliveryFeeFCFA       int64                      `json:"deliveryFeeFCFA"`
	DiscountFCFA          int64                      `json:"discountFCFA"`
	UsePrepaid            bool                       `json:"usePrepaid"`
	PrepaidAmountFCFA     int64                      `json:"prepaidAmountFCFA"`
	LoyaltyPointsRedeemed int64                      `json:"loyaltyPointsRedeemed"`
	InitialPaymentMethod  pressing.PaymentMethod     `json:"initialPaymentMethod"`
	InitialCashPaidFCFA   *int64                     `json:"initialCashPaidFCFA"`
	DropOffDate           string                     `json:"dropOffDate"`
	DueDate               *string                    `json:"dueDate"`
	Notes                 string                     `json:"notes"`
	ClaimPhotos           []pressing.OrderClaimPhoto `json:"claimPhotos"`
}

func (r MappingRequest) toPricingInput() service.PricingInput {
	var notes *string
	if r.Notes != "" {
		notes = &r.Notes
	}
	return service.PricingInput{
		ClientID:              r.ClientID,
		NewClient:             r.NewClient,
		ClientName:            r.ClientName,
		ClientPhone:           r.ClientPhone,
		Commune:               r.Commune,
		RackSlot:              r.RackSlot,
		Items:                 r.Items,
		DeliveryZoneID:        r.DeliveryZoneID,
		DiscountFCFA:          r.DiscountFCFA,
		UsePrepaid:            r.UsePrepaid,
		PrepaidAmountFCFA:     r.PrepaidAmountFCFA,
		LoyaltyPointsRedeemed: r.LoyaltyPointsRedeemed,
		InitialPaymentMethod:  r.InitialPaymentMethod,
		InitialCashPaidFCFA:   r.InitialCashPaidFCFA,
		DropOffDate:           r.DropOffDate,
		DueDate:               r.DueDate,
		Notes:                 notes,
	}
}

type StatusRequest struct {
	Status string `json:"status"`
}

type PaymentRequest struct {
	AmountFCFA     int64                  `json:"amountFCFA"`
	Method         pressing.PaymentMethod `json:"method"`
	IdempotencyKey string                 `json:"idempotencyKey,omitempty"`
}

type TopupRequest struct {
	AmountFCFA            int64                  `json:"amountFCFA"`
	BonusFCFA             int64                  `json:"bonusFCFA"`
	Method                pressing.PaymentMethod `json:"method"`
	SubscriptionLabel     string                 `json:"subscriptionLabel"`
	SubscriptionExpiresAt string                 `json:"subscriptionExpiresAt"`
	Note                  string                 `json:"note"`
	IdempotencyKey        string                 `json:"idempotencyKey,omitempty"`
}

type MovementRequest struct {
	Type           pressing.InventoryMovementType `json:"type"`
	Quantity       float64                        `json:"quantity"`
	UnitCostFCFA   *int64                         `json:"unitCostFCFA"`
	Reason         string                         `json:"reason"`
	RecordExpense  bool                           `json:"recordExpense"`
	PaymentMethod  pressing.PaymentMethod         `json:"paymentMethod"`
	IdempotencyKey string                         `json:"idempotencyKey,omitempty"`
}
