package http

import (
	"github.com/erwinsskoffi/press_backend/internal/domain/pressing"
	"github.com/erwinsskoffi/press_backend/internal/service"
)

// Envelope : format standard des réponses /api/v1.
type Envelope struct {
	Success bool   `json:"success"`
	Data    any    `json:"data"`
	Error   string `json:"error,omitempty"`
	Code    string `json:"code,omitempty"`
}

type MappingRequest struct {
	ClientID       *string                  `json:"clientId"`
	Items          []pressing.OrderLineItem `json:"items"`
	Notes          string                   `json:"notes"`
	IsExpress      bool                     `json:"isExpress"`
	DeliveryZoneID *string                  `json:"deliveryZoneId"`
	DiscountFCFA   int64                    `json:"discountFCFA"`
	UsePrepaid     bool                     `json:"usePrepaid"`
	// InitialCashPaidFCFA : acompte espèces/mobile payé au dépôt (nil = solde complet).
	InitialCashPaidFCFA *int64                     `json:"initialCashPaidFCFA"`
	RedeemLoyalty       bool                       `json:"redeemLoyalty"`
	InitialPayment      pressing.PaymentMethod     `json:"initialPaymentMethod"`
	NewClient           *pressing.Client           `json:"newClient"`
	ClaimPhotos         []pressing.OrderClaimPhoto `json:"claimPhotos"`
}

type StatusRequest struct {
	Status string `json:"status"`
}

type PaymentRequest struct {
	AmountFCFA int64                  `json:"amountFCFA"`
	Method     pressing.PaymentMethod `json:"method"`
}

type TopupRequest struct {
	AmountFCFA            int64                  `json:"amountFCFA"`
	BonusFCFA             int64                  `json:"bonusFCFA"`
	Method                pressing.PaymentMethod `json:"method"`
	SubscriptionLabel     string                 `json:"subscriptionLabel"`
	SubscriptionExpiresAt string                 `json:"subscriptionExpiresAt"`
	Note                  string                 `json:"note"`
}

type MovementRequest struct {
	Type          pressing.InventoryMovementType `json:"type"`
	Quantity      float64                        `json:"quantity"`
	UnitCostFCFA  *int64                         `json:"unitCostFCFA"`
	Reason        string                         `json:"reason"`
	RecordExpense bool                           `json:"recordExpense"`
	PaymentMethod pressing.PaymentMethod         `json:"paymentMethod"`
}

func (r MappingRequest) toPricingInput() service.PricingInput {
	var notes *string
	if r.Notes != "" {
		notes = &r.Notes
	}
	return service.PricingInput{
		ClientID:             r.ClientID,
		Items:                r.Items,
		Notes:                notes,
		DeliveryZoneID:       r.DeliveryZoneID,
		DiscountFCFA:         r.DiscountFCFA,
		UsePrepaid:           r.UsePrepaid,
		InitialCashPaidFCFA:  r.InitialCashPaidFCFA,
		InitialPaymentMethod: r.InitialPayment,
		NewClient:            r.NewClient,
	}
}
