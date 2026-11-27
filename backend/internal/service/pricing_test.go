package service

import (
	"errors"
	"testing"

	"github.com/erwinsskoffi/press_backend/internal/domain/pressing"
)

// fixture : paramétrage de référence (parité paramétrage frontend).
func testSettings() *pressing.PressingSettings {
	return &pressing.PressingSettings{
		ID: "default", ShopName: "Éclat", ActivityScope: pressing.ScopeBoth,
		PressingConfig: pressing.PressingConfig{
			PricePerKgByMode: map[string]int64{
				string(pressing.ModeLavageSimple):    1000,
				string(pressing.ModeLavageRepassage): 1500,
				string(pressing.ModeBlanchisserie):   2000,
			},
			WeightOffers: []pressing.PressingWeightOffer{
				{ID: "couette2p", Label: "Couette 2 places", WeightKg: 3.0,
					Mode: pressing.ModeBlanchisserie, PriceFCFA: 6000, Active: true},
				{ID: "off", Label: "Off", WeightKg: 2.0,
					Mode: pressing.ModeBlanchisserie, PriceFCFA: 4000, Active: false},
			},
			ExpressPricingMode:     pressing.ExpressPercent,
			ExpressPercent:         50,
			ExpressFixedAmountFCFA: 500,
		},
		BlanchisserieConfig: pressing.BlanchisserieConfig{
			EnableUnit:     true,
			UnitPricesFCFA: map[string]int64{string(pressing.ModeBlanchisserie): 700},
			Packs: []pressing.BlanchisseriePack{
				{ID: "p10", GarmentCount: 10, Active: true,
					PricesFCFA: map[string]int64{string(pressing.ModeBlanchisserie): 5000}},
			},
		},
		LoyaltyConfig: pressing.LoyaltyConfig{
			Enabled: true, FcfaPerPoint: 1000, RewardThresholdPoints: 50, RewardDiscountFCFA: 2000,
		},
	}
}

func catLookup(items ...*pressing.CatalogItem) func(string) *pressing.CatalogItem {
	return func(id string) *pressing.CatalogItem {
		for _, it := range items {
			if it.ID == id {
				return it
			}
		}
		return nil
	}
}

func chemise() *pressing.CatalogItem {
	return &pressing.CatalogItem{ID: "cat-chemise", Name: "Chemise", Category: "Habit",
		DefaultMode: pressing.ModeLavageRepassage, PriceFCFA: 1000, Unit: "pièce", Active: true}
}

func TestRecalculateCatalogPiece(t *testing.T) {
	s := testSettings()
	in := PricingInput{
		Items: []pressing.OrderLineItem{
			{CatalogItemID: strPtr("cat-chemise"), Name: "Chemise", Mode: pressing.ModeLavageRepassage,
				Quantity: 3, Unit: "pièce", UnitPriceFCFA: 1}, // prix client volontaire faux
		},
	}
	res, err := RecalculateOrder(in, s, nil, nil, catLookup(chemise()))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	o := res.Order
	if o.SubtotalFCFA != 3000 || o.TotalFCFA != 3000 {
		t.Fatalf("prix imposé par le serveur: subtotal=%d total=%d", o.SubtotalFCFA, o.TotalFCFA)
	}
	if o.Items[0].UnitPriceFCFA != 1000 {
		t.Fatalf("unitPrice=%d, attendu 1000 (prix catalogue)", o.Items[0].UnitPriceFCFA)
	}
}

func TestRecalculateCatalogMissingOrInactive(t *testing.T) {
	s := testSettings()
	off := chemise()
	off.Active = false
	in := PricingInput{Items: []pressing.OrderLineItem{
		{CatalogItemID: strPtr("cat-chemise"), Mode: pressing.ModeLavageRepassage, Quantity: 1, Unit: "pièce"}}}
	if _, err := RecalculateOrder(in, s, nil, nil, catLookup(off)); !errors.Is(err, ErrCatalogItemMissing) {
		t.Fatalf("inactif: %v", err)
	}
	in2 := PricingInput{Items: []pressing.OrderLineItem{
		{CatalogItemID: strPtr("cat-inconnu"), Mode: pressing.ModeLavageRepassage, Quantity: 1, Unit: "pièce"}}}
	if _, err := RecalculateOrder(in2, s, nil, nil, catLookup()); !errors.Is(err, ErrCatalogItemMissing) {
		t.Fatalf("inconnu: %v", err)
	}
}

func TestRecalculateCustomKg(t *testing.T) {
	s := testSettings()
	in := PricingInput{Items: []pressing.OrderLineItem{
		{Name: "Linge au kilo", Mode: pressing.ModeLavageRepassage, Quantity: 1, Unit: "kg", WeightKg: f64(1.75)}}}
	res, err := RecalculateOrder(in, s, nil, nil, nil)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if res.Order.SubtotalFCFA != 2625 { // 1.75 × 1500
		t.Fatalf("kilo: %d, attendu 2625", res.Order.SubtotalFCFA)
	}
}

func TestRecalculateWeightOffer(t *testing.T) {
	s := testSettings()
	in := PricingInput{Items: []pressing.OrderLineItem{
		{CatalogItemID: strPtr("kg-couette2p"), Name: "x", Mode: pressing.ModeLavageRepassage,
			Quantity: 1, Unit: "pièce", UnitPriceFCFA: 99999}}}
	res, err := RecalculateOrder(in, s, nil, nil, nil)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	line := res.Order.Items[0]
	if line.UnitPriceFCFA != 6000 || line.WeightKg == nil || *line.WeightKg != 3.0 ||
		line.Mode != pressing.ModeBlanchisserie || line.Unit != "kg" {
		t.Fatalf("offre poids imposée: %+v", line)
	}
	in2 := PricingInput{Items: []pressing.OrderLineItem{
		{CatalogItemID: strPtr("kg-off"), Quantity: 1, Unit: "pièce", Mode: pressing.ModeBlanchisserie}}}
	if _, err := RecalculateOrder(in2, s, nil, nil, nil); !errors.Is(err, ErrWeightOfferMissing) {
		t.Fatalf("offre inactive: %v", err)
	}
}

func TestRecalculateBlanchisserie(t *testing.T) {
	s := testSettings()
	// pack
	in := PricingInput{Items: []pressing.OrderLineItem{
		{Name: "Blanchisserie · Programme 10 vêtements", Mode: pressing.ModeBlanchisserie,
			Quantity: 1, Unit: "lot", PricingBasis: strPtr("p10"), PiecesPerUnit: intPtr(10)}}}
	res, err := RecalculateOrder(in, s, nil, nil, nil)
	if err != nil {
		t.Fatalf("pack: %v", err)
	}
	if res.Order.SubtotalFCFA != 5000 {
		t.Fatalf("pack prix: %d", res.Order.SubtotalFCFA)
	}
	// à l'unité
	in2 := PricingInput{Items: []pressing.OrderLineItem{
		{Name: "Drap", Mode: pressing.ModeBlanchisserie, Quantity: 3, Unit: "pièce", PricingBasis: strPtr("unite")}}}
	res2, err := RecalculateOrder(in2, s, nil, nil, nil)
	if err != nil {
		t.Fatalf("unité: %v", err)
	}
	if res2.Order.SubtotalFCFA != 2100 { // 3 × 700
		t.Fatalf("unité prix: %d", res2.Order.SubtotalFCFA)
	}
	// pack inconnu
	in3 := PricingInput{Items: []pressing.OrderLineItem{
		{Mode: pressing.ModeBlanchisserie, Quantity: 1, Unit: "lot", PricingBasis: strPtr("nope")}}}
	if _, err := RecalculateOrder(in3, s, nil, nil, nil); !errors.Is(err, ErrBlanchPackMissing) {
		t.Fatalf("pack inconnu: %v", err)
	}
}

func TestRecalculateExpress(t *testing.T) {
	s := testSettings() // express = 50 %
	in := PricingInput{Items: []pressing.OrderLineItem{
		{CatalogItemID: strPtr("cat-chemise"), Mode: pressing.ModeLavageRepassage,
			Quantity: 2, Unit: "pièce", IsExpress: true}}}
	res, _ := RecalculateOrder(in, s, nil, nil, catLookup(chemise()))
	if res.Order.ExpressFeeFCFA != 1000 { // 50 % × (2 × 1000)
		t.Fatalf("express %%: %d", res.Order.ExpressFeeFCFA)
	}
	if !res.Order.IsExpress || res.Order.TotalFCFA != 3000 {
		t.Fatalf("total express: %+v", res.Order)
	}
	// mode fixe / pièce : quantité multipliée sauf kg
	s2 := testSettings()
	s2.PressingConfig.ExpressPricingMode = pressing.ExpressFixedPerPiece
	in2 := PricingInput{Items: []pressing.OrderLineItem{
		{CatalogItemID: strPtr("cat-chemise"), Mode: pressing.ModeLavageRepassage,
			Quantity: 3, Unit: "pièce", IsExpress: true}}}
	res2, _ := RecalculateOrder(in2, s2, nil, nil, catLookup(chemise()))
	if res2.Order.ExpressFeeFCFA != 1500 { // 500 × 3
		t.Fatalf("express fixe: %d", res2.Order.ExpressFeeFCFA)
	}
	in3 := PricingInput{Items: []pressing.OrderLineItem{
		{CatalogItemID: strPtr("kg-couette2p"), Mode: pressing.ModeBlanchisserie, Quantity: 2, IsExpress: true}}}
	res3, _ := RecalculateOrder(in3, s2, nil, nil, nil)
	if res3.Order.ExpressFeeFCFA != 500 { // kg : pas de multiplication
		t.Fatalf("express fixe kg: %d", res3.Order.ExpressFeeFCFA)
	}
}

func TestRecalculateZone(t *testing.T) {
	s := testSettings()
	zone := &pressing.DeliveryZone{ID: "z1", Commune: "Cocody", FeeFCFA: 1500, Active: true}
	in := PricingInput{DeliveryZoneID: strPtr("z1"), Items: []pressing.OrderLineItem{
		{CatalogItemID: strPtr("cat-chemise"), Mode: pressing.ModeLavageRepassage, Quantity: 1, Unit: "pièce"}}}
	res, _ := RecalculateOrder(in, s, nil, zone, catLookup(chemise()))
	if res.Order.DeliveryFeeFCFA != 1500 || res.Order.TotalFCFA != 2500 {
		t.Fatalf("zone: %+v", res.Order)
	}
	if res.Order.DeliveryFeeFCFA != 1500 { // le fee envoyé par le navigateur est ignoré
		t.Fatalf("fee client ignoré")
	}
	if _, err := RecalculateOrder(in, s, nil, nil, catLookup(chemise())); !errors.Is(err, ErrZoneMissing) {
		t.Fatalf("zone absente: %v", err)
	}
	zone.Active = false
	if _, err := RecalculateOrder(in, s, nil, zone, catLookup(chemise())); !errors.Is(err, ErrZoneMissing) {
		t.Fatalf("zone inactive: %v", err)
	}
}

func TestRecalculateLoyalty(t *testing.T) {
	s := testSettings()
	client := &pressing.Client{ID: "c1", LoyaltyPoints: 60, PrepaidBalanceFCFA: 0}
	in := PricingInput{
		Items: []pressing.OrderLineItem{{CatalogItemID: strPtr("cat-chemise"),
			Mode: pressing.ModeLavageRepassage, Quantity: 10, Unit: "pièce"}}, // 10000
		LoyaltyPointsRedeemed: 50,
	}
	res, _ := RecalculateOrder(in, s, client, nil, catLookup(chemise()))
	if res.LoyaltyDiscountFCFA != 2000 || res.Order.TotalFCFA != 8000 || res.Order.LoyaltyPointsRedeemed != 50 {
		t.Fatalf("fidélité: %+v", res.Order)
	}
	if res.Order.LoyaltyPointsEarned != 8 { // 8000/1000
		t.Fatalf("points gagnés: %d", res.Order.LoyaltyPointsEarned)
	}
	// non éligible
	client2 := &pressing.Client{ID: "c2", LoyaltyPoints: 49}
	res2, _ := RecalculateOrder(in, s, client2, nil, catLookup(chemise()))
	if res2.LoyaltyDiscountFCFA != 0 || res2.Order.TotalFCFA != 10000 {
		t.Fatalf("non éligible accepté: %+v", res2.Order)
	}
	// désactivé
	s3 := testSettings()
	s3.LoyaltyConfig.Enabled = false
	res3, _ := RecalculateOrder(in, s3, client, nil, catLookup(chemise()))
	if res3.LoyaltyDiscountFCFA != 0 || res3.Order.LoyaltyPointsEarned != 0 {
		t.Fatalf("fidélité désactivée: %+v", res3.Order)
	}
}

func TestRecalculateDiscountClamp(t *testing.T) {
	s := testSettings()
	in := PricingInput{
		Items: []pressing.OrderLineItem{{CatalogItemID: strPtr("cat-chemise"),
			Mode: pressing.ModeLavageRepassage, Quantity: 1, Unit: "pièce"}},
		DiscountFCFA: 999999, // bornée par le sous-total
	}
	res, _ := RecalculateOrder(in, s, nil, nil, catLookup(chemise()))
	if res.Order.DiscountFCFA != 1000 || res.Order.TotalFCFA != 0 {
		t.Fatalf("remise non bornée: %+v", res.Order)
	}
}

func TestRecalculatePrepaidClamps(t *testing.T) {
	s := testSettings()
	// jamais plus que le total
	client := &pressing.Client{ID: "c1", PrepaidBalanceFCFA: 50000}
	in := PricingInput{
		Items: []pressing.OrderLineItem{{CatalogItemID: strPtr("cat-chemise"),
			Mode: pressing.ModeLavageRepassage, Quantity: 2, Unit: "pièce"}},
		UsePrepaid: true,
	}
	res, _ := RecalculateOrder(in, s, client, nil, catLookup(chemise()))
	if res.ActualPrepaidUsedFCFA != 2000 || res.CashDueFCFA != 0 {
		t.Fatalf("clamp total: %+v", res)
	}
	// jamais plus que le solde
	client.PrepaidBalanceFCFA = 1500
	res2, _ := RecalculateOrder(in, s, client, nil, catLookup(chemise()))
	if res2.ActualPrepaidUsedFCFA != 1500 || res2.CashDueFCFA != 500 {
		t.Fatalf("clamp solde: %+v", res2)
	}
	// montant demandé explicite
	client.PrepaidBalanceFCFA = 10000
	in.PrepaidAmountFCFA = 500
	res3, _ := RecalculateOrder(in, s, client, nil, catLookup(chemise()))
	if res3.ActualPrepaidUsedFCFA != 500 || res3.CashDueFCFA != 1500 {
		t.Fatalf("montant demandé: %+v", res3)
	}
	// client de passage : pas de prépayé
	res4, _ := RecalculateOrder(in, s, nil, nil, catLookup(chemise()))
	if res4.ActualPrepaidUsedFCFA != 0 || res4.CashDueFCFA != 2000 {
		t.Fatalf("client nil: %+v", res4)
	}
}

func TestRecalculateCashPartial(t *testing.T) {
	s := testSettings()
	in := PricingInput{
		Items: []pressing.OrderLineItem{{CatalogItemID: strPtr("cat-chemise"),
			Mode: pressing.ModeLavageRepassage, Quantity: 30, Unit: "pièce"}}, // 30000
		InitialCashPaidFCFA: i64(5000),
	}
	res, _ := RecalculateOrder(in, s, nil, nil, catLookup(chemise()))
	if res.CashDueFCFA != 30000 || res.CashPaidFCFA != 5000 {
		t.Fatalf("acompte: %+v", res)
	}
	// acompte > dû : clampé (jamais d'encaissement excédentaire)
	in.InitialCashPaidFCFA = i64(99999)
	res2, _ := RecalculateOrder(in, s, nil, nil, catLookup(chemise()))
	if res2.CashPaidFCFA != 30000 {
		t.Fatalf("acompte non clampé: %+v", res2)
	}
}

func TestRecalculateValidation(t *testing.T) {
	s := testSettings()
	bad := PricingInput{Items: []pressing.OrderLineItem{
		{Mode: pressing.ModeLavageRepassage, Quantity: 0, Unit: "pièce"}}}
	if _, err := RecalculateOrder(bad, s, nil, nil, nil); !errors.Is(err, ErrInvalidQuantity) {
		t.Fatalf("quantité 0: %v", err)
	}
	neg := PricingInput{Items: []pressing.OrderLineItem{
		{Mode: pressing.ModeLavageRepassage, Quantity: -2, Unit: "pièce"}}}
	if _, err := RecalculateOrder(neg, s, nil, nil, nil); !errors.Is(err, ErrInvalidQuantity) {
		t.Fatalf("quantité négative: %v", err)
	}
	badPay := PricingInput{Items: []pressing.OrderLineItem{
		{CatalogItemID: strPtr("cat-chemise"), Mode: pressing.ModeLavageRepassage, Quantity: 1, Unit: "pièce"}},
		InitialPaymentMethod: "bitcoin"}
	if _, err := RecalculateOrder(badPay, s, nil, nil, catLookup(chemise())); !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("moyen de paiement: %v", err)
	}
}

func TestRecalculateOverflowSafe(t *testing.T) {
	s := testSettings()
	// grande quantité : pas de négatif, pas d'overflow int64
	in := PricingInput{Items: []pressing.OrderLineItem{
		{CatalogItemID: strPtr("cat-chemise"), Mode: pressing.ModeLavageRepassage,
			Quantity: 1e6, Unit: "pièce"}}}
	res, err := RecalculateOrder(in, s, nil, nil, catLookup(chemise()))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if res.Order.TotalFCFA <= 0 {
		t.Fatalf("overflow: %d", res.Order.TotalFCFA)
	}
}

func TestRecalculateRounding(t *testing.T) {
	s := testSettings()
	s.PressingConfig.ExpressPricingMode = pressing.ExpressPercent
	s.PressingConfig.ExpressPercent = 33 // 33 % de 666 = 219.78 → 220
	in := PricingInput{Items: []pressing.OrderLineItem{
		{CatalogItemID: strPtr("cat-chemise"), Mode: pressing.ModeLavageRepassage,
			Quantity: 1, Unit: "pièce", IsExpress: true},
		{CatalogItemID: strPtr("cat-chemise"), Mode: pressing.ModeLavageRepassage,
			Quantity: 1, Unit: "pièce", IsExpress: true},
	}}
	// 2 lignes de 1000 : express 33 % = 330 chacune
	res, _ := RecalculateOrder(in, s, nil, nil, catLookup(chemise()))
	if res.Order.ExpressFeeFCFA != 660 || res.Order.TotalFCFA != 2660 {
		t.Fatalf("arrondi: express=%d total=%d", res.Order.ExpressFeeFCFA, res.Order.TotalFCFA)
	}
}

func f64(v float64) *float64 { return &v }
func i64(v int64) *int64     { return &v }
