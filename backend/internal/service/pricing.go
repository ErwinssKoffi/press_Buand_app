package service

import (
	"fmt"
	"math"

	"github.com/erwinsskoffi/press_backend/internal/domain/pressing"
	"github.com/erwinsskoffi/press_backend/internal/platform/ids"
)

// Erreurs métier typées (ADR A11 : mapping handler → 422).
var (
	ErrOverpayment         = fmt.Errorf("paiement supérieur au solde restant")
	ErrInsufficientStock   = fmt.Errorf("sortie de stock supérieure au disponible")
	ErrInsufficientPrepaid = fmt.Errorf("solde prépayé insuffisant")
	ErrLoyaltyNotEligible  = fmt.Errorf("points de fidélité insuffisants")
	ErrInvalidTransition   = fmt.Errorf("transition de statut invalide")
	ErrVoidedOrder         = fmt.Errorf("commande annulée : opération refusée")
	ErrCatalogItemMissing  = fmt.Errorf("article de catalogue introuvable ou inactif")
	ErrWeightOfferMissing  = fmt.Errorf("offre au poids introuvable ou inactive")
	ErrBlanchPackMissing   = fmt.Errorf("programme blanchisserie introuvable ou inactif")
	ErrZoneMissing         = fmt.Errorf("zone de livraison introuvable ou inactive")
	ErrInvalidAmount       = fmt.Errorf("montant invalide")
	ErrInvalidQuantity     = fmt.Errorf("quantité invalide")
)

// PricingInput : brouillon de dépôt envoyé par le terminal.
// Les montants du client ne sont jamais considérés autoritaires (ADR A13).
type PricingInput struct {
	ClientID          *string
	NewClient         *pressing.Client
	ClientName        string
	ClientPhone       string
	Commune           string
	RackSlot          string
	Items             []pressing.OrderLineItem
	DeliveryZoneID    *string
	DeliveryFeeFCFA   int64 // ignoré : recalculé depuis la zone
	DiscountFCFA      int64 // remise commerciale libre, bornée par le serveur
	UsePrepaid        bool
	PrepaidAmountFCFA int64
	// InitialCashPaidFCFA : acompte cash versé au dépôt (nil = tout le cash dû).
	InitialCashPaidFCFA   *int64
	LoyaltyPointsRedeemed int64
	InitialPaymentMethod  pressing.PaymentMethod
	DropOffDate           string
	DueDate               *string
	Notes                 *string
}

// PricingResult : commande recalculée + décomposition des paiements.
type PricingResult struct {
	Order                 *pressing.Order
	ActualPrepaidUsedFCFA int64
	CashDueFCFA           int64
	CashPaidFCFA          int64 // acompte réellement encaissé (≤ CashDue)
	LoyaltyDiscountFCFA   int64
}

// recalcLineExpressFee portage exact de computeLineExpressFee (src/utils/formatters.ts).
func recalcLineExpressFee(line pressing.OrderLineItem, pc pressing.PressingConfig) int64 {
	if !line.IsExpress {
		return 0
	}
	if pc.ExpressPricingMode == pressing.ExpressFixedPerPiece {
		multiplier := 1.0
		if line.Unit != "kg" && line.Quantity > 1 {
			multiplier = line.Quantity
		}
		return max64(0, round64(float64(pc.ExpressFixedAmountFCFA)*multiplier))
	}
	pct := pc.ExpressPercent
	return max64(0, round64(float64(line.Quantity)*float64(line.UnitPriceFCFA)*float64(pct)/100))
}

// lineLineTotal : prix ligne = quantité × prix unitaire (entiers FCFA).
func lineLineTotal(line pressing.OrderLineItem) int64 {
	return max64(0, round64(float64(line.UnitPriceFCFA)*line.Quantity))
}

// RecalculateOrder recompose et valide une commande à partir du catalogue,
// des offres/packs, de la zone de livraison et de la fidélité — côté serveur.
// client peut être nil (client de passage).
func RecalculateOrder(in PricingInput, settings *pressing.PressingSettings, client *pressing.Client, zone *pressing.DeliveryZone, lookupCatalog func(id string) *pressing.CatalogItem) (*PricingResult, error) {
	pc := settings.PressingConfig
	items := make([]pressing.OrderLineItem, 0, len(in.Items))
	var subtotal, expressTotal int64

	for _, raw := range in.Items {
		line := raw
		if line.Quantity <= 0 {
			return nil, ErrInvalidQuantity
		}
		// 1. Prix unitaire autoritaire
		switch {
		case line.CatalogItemID != nil && !isPseudoCatalog(*line.CatalogItemID):
			// article réel : le serveur impose le prix catalogue
			if !pressing.ValidServiceMode(string(line.Mode)) {
				return nil, ErrInvalidQuantity
			}
			line.UnitPriceFCFA = priceFromCatalog(line, pc, lookupCatalog)
			if line.UnitPriceFCFA < 0 {
				return nil, ErrCatalogItemMissing
			}
		case line.CatalogItemID != nil && len(*line.CatalogItemID) > 3 && (*line.CatalogItemID)[:3] == "kg-":
			// offre au poids : prix et poids imposés par l'offre
			offer := findWeightOffer(pc, *line.CatalogItemID)
			if offer == nil {
				return nil, ErrWeightOfferMissing
			}
			line.UnitPriceFCFA = offer.PriceFCFA
			w := offer.WeightKg
			line.WeightKg = &w
			line.Mode = offer.Mode
			line.Unit = "kg"
			line.ActivityType = strPtr("pressing")
			line.PiecesPerUnit = intPtr(0)
		case line.WeightKg != nil && *line.WeightKg > 0:
			// pressing au kilo mesuré : tarif/kg du mode (le client peut ajuster via la remise)
			rate := pc.PricePerKgByMode[string(line.Mode)]
			line.UnitPriceFCFA = max64(0, round64(*line.WeightKg*float64(rate)))
		case line.PricingBasis != nil:
			// programme blanchisserie (pack ou unité) : prix imposé par le paramétrage
			price, err := blanchPrice(settings.BlanchisserieConfig, *line.PricingBasis, string(line.Mode))
			if err != nil {
				return nil, err
			}
			line.UnitPriceFCFA = price
		}

		if line.ID == "" {
			line.ID = ids.NewUUID()
		}
		line.LineTotalFCFA = lineLineTotal(line)
		line.ExpressFeeFCFA = recalcLineExpressFee(line, pc)
		subtotal += line.LineTotalFCFA
		expressTotal += line.ExpressFeeFCFA
		items = append(items, line)
	}

	// 2. Livraison : uniquement depuis la zone validée
	var delivery int64
	if in.DeliveryZoneID != nil {
		if zone == nil || !zone.Active {
			return nil, ErrZoneMissing
		}
		delivery = zone.FeeFCFA
	}

	// 3. Remise fidélité (revalidation serveur)
	loyaltyDiscount := int64(0)
	pointsRedeemed := int64(0)
	if in.LoyaltyPointsRedeemed > 0 && settings.LoyaltyConfig.Enabled && client != nil {
		cfg := settings.LoyaltyConfig
		if client.LoyaltyPoints >= cfg.RewardThresholdPoints {
			loyaltyDiscount = cfg.RewardDiscountFCFA
			pointsRedeemed = cfg.RewardThresholdPoints
		}
	}

	// 4. Remise commerciale bornée
	discount := clamp64(in.DiscountFCFA, 0, subtotal+expressTotal+delivery)

	total := max64(0, subtotal+expressTotal+delivery-discount-loyaltyDiscount)

	// 5. Points gagnés (parité createOrderWithPayment)
	pointsEarned := int64(0)
	if settings.LoyaltyConfig.Enabled {
		per := settings.LoyaltyConfig.FcfaPerPoint
		if per < 100 {
			per = 100
		}
		pointsEarned = total / per
	}

	// 6. Prépayé réel (jamais plus que le solde et le total)
	var prepaidUsed int64
	if in.UsePrepaid && client != nil && client.PrepaidBalanceFCFA > 0 {
		requested := max64(0, in.PrepaidAmountFCFA)
		if requested == 0 {
			// non fourni : le solde réel du client sert de demande (solde revalidé en base)
			requested = client.PrepaidBalanceFCFA
		}
		prepaidUsed = min64(min64(client.PrepaidBalanceFCFA, total), requested)
	}
	cashDue := max64(0, total-prepaidUsed)
	cashPaid := cashDue
	if in.InitialCashPaidFCFA != nil {
		cashPaid = clamp64(*in.InitialCashPaidFCFA, 0, cashDue)
	}

	if in.InitialPaymentMethod != "" && !pressing.ValidPaymentMethod(string(in.InitialPaymentMethod)) {
		return nil, ErrInvalidAmount
	}

	status := pressing.StatusRecu
	order := &pressing.Order{
		ClientID:              in.ClientID,
		ClientName:            in.ClientName,
		ClientPhone:           in.ClientPhone,
		Commune:               in.Commune,
		RackSlot:              in.RackSlot,
		Items:                 items,
		IsExpress:             expressTotal > 0,
		ExpressFeeFCFA:        expressTotal,
		DeliveryFeeFCFA:       delivery,
		DiscountFCFA:          discount + loyaltyDiscount,
		PrepaidUsedFCFA:       prepaidUsed,
		LoyaltyPointsEarned:   pointsEarned,
		LoyaltyPointsRedeemed: pointsRedeemed,
		SubtotalFCFA:          subtotal,
		TotalFCFA:             total,
		PaidFCFA:              0,
		Status:                status,
		DropOffDate:           in.DropOffDate,
		DueDate:               in.DueDate,
		Notes:                 in.Notes,
	}
	return &PricingResult{
		Order:                 order,
		CashPaidFCFA:          cashPaid,
		ActualPrepaidUsedFCFA: prepaidUsed,
		CashDueFCFA:           cashDue,
		LoyaltyDiscountFCFA:   loyaltyDiscount,
	}, nil
}

func isPseudoCatalog(id string) bool {
	return len(id) >= 3 && (id[:3] == "kg-" || id[:3] == "bl-")
}

func findWeightOffer(pc pressing.PressingConfig, catalogID string) *pressing.PressingWeightOffer {
	for i := range pc.WeightOffers {
		if "kg-"+pc.WeightOffers[i].ID == catalogID && pc.WeightOffers[i].Active {
			return &pc.WeightOffers[i]
		}
	}
	return nil
}

func blanchPrice(bc pressing.BlanchisserieConfig, basis, service string) (int64, error) {
	if !pressing.ValidServiceMode(service) {
		return 0, ErrBlanchPackMissing
	}
	if basis == "unite" {
		if !bc.EnableUnit {
			return 0, ErrBlanchPackMissing
		}
		if p, ok := bc.UnitPricesFCFA[service]; ok {
			return max64(0, p), nil
		}
		return 0, ErrBlanchPackMissing
	}
	for _, pack := range bc.Packs {
		if pack.ID == basis && pack.Active {
			if p, ok := pack.PricesFCFA[service]; ok {
				return max64(0, p), nil
			}
		}
	}
	return 0, ErrBlanchPackMissing
}

// priceFromCatalog impose le prix catalogue (le client ne fixe jamais un prix).
func priceFromCatalog(line pressing.OrderLineItem, pc pressing.PressingConfig, lookupCatalog func(id string) *pressing.CatalogItem) int64 {
	if lookupCatalog == nil {
		return -1
	}
	item := lookupCatalog(*line.CatalogItemID)
	if item == nil || !item.Active {
		return -1
	}
	if line.Unit == "kg" && line.Mode == pressing.ModeBlanchisserie {
		// ligne au kilo déclarée depuis le catalogue : tarif/kg paramétré
		return max64(0, pc.PricePerKgByMode[string(line.Mode)])
	}
	return item.PriceFCFA
}

func round64(v float64) int64 {
	return int64(math.Round(v))
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
func clamp64(v, lo, hi int64) int64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func strPtr(s string) *string { return &s }
func intPtr(i int) *int       { return &i }
