package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/erwinsskoffi/press_backend/internal/domain/pressing"
	"github.com/erwinsskoffi/press_backend/internal/service"
)

// API : handlers REST métier /api/v1 (enveloppe standard, erreurs métier typées).
type API struct {
	orders    *service.OrderService
	settings  *service.SettingsService
	catalog   *service.CatalogService
	clients   *service.ClientService
	logistics *service.LogisticsService
	inventory *service.InventoryService
	cashbook  *service.CashbookService
	reports   *service.ReportsService
	expenses  service.ExpenseStore
}

func NewAPI(orders *service.OrderService, settings *service.SettingsService, catalog *service.CatalogService,
	clients *service.ClientService, logistics *service.LogisticsService, inventory *service.InventoryService,
	cashbook *service.CashbookService, reports *service.ReportsService, expenses service.ExpenseStore) *API {
	return &API{orders, settings, catalog, clients, logistics, inventory, cashbook, reports, expenses}
}

func (a *API) Routes(r chi.Router) {
	// Pressing
	r.Get("/pressing/settings", a.getSettings)
	r.Put("/pressing/settings", a.updateSettings)
	r.Get("/pressing/catalog", a.listCatalog)
	r.Post("/pressing/catalog", a.saveCatalog)
	r.Delete("/pressing/catalog/{id}", a.deactivateCatalog)

	r.Get("/orders", a.listOrders)
	r.Post("/orders", a.createOrder)
	r.Post("/orders/mapping", a.mapping)
	r.Route("/orders/{id}", func(r chi.Router) {
		r.Get("/", a.getOrder)
		r.Get("/payments", a.orderPayments)
		r.Post("/payments", a.addPayment)
		r.Patch("/status", a.advanceStatus)
		r.Post("/void", a.voidOrder)
		r.Get("/photos/{photoId}", a.claimPhoto)
	})

	r.Get("/clients", a.listClients)
	r.Post("/clients", a.saveClient)
	r.Route("/clients/{id}", func(r chi.Router) {
		r.Get("/", a.getClient)
		r.Put("/", a.saveClientID)
		r.Post("/wallet/topups", a.topup)
		r.Post("/archive", a.archiveClient)
	})

	r.Get("/zones", a.listZones)
	r.Post("/zones", a.saveZone)
	r.Delete("/zones/{id}", a.deleteZone)

	r.Get("/logistics", a.listLogistics)
	r.Post("/logistics", a.saveTask)
	r.Post("/logistics/{id}/status", a.taskStatus)
	r.Delete("/logistics/{id}", a.deleteTask)

	r.Get("/inventory", a.listInventory)
	r.Post("/inventory", a.saveItem)
	r.Route("/inventory/{id}", func(r chi.Router) {
		r.Post("/movements", a.movement)
		r.Get("/movements", a.listMovements)
		r.Post("/archive", a.archiveItem)
	})

	r.Get("/expenses", a.listExpenses)
	r.Post("/expenses", a.createExpense)
	r.Delete("/expenses/{id}", a.deleteExpense)

	r.Get("/reports/z", a.dailyZ)
	r.Get("/reports/monthly", a.monthlyReport)
}

// --- helpers ---

func respondJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func ok(w http.ResponseWriter, data any) {
	respondJSON(w, http.StatusOK, Envelope{Success: true, Data: data})
}

func fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, service.ErrIdempotentReplay):
		respondJSON(w, http.StatusConflict, Envelope{Success: false, Error: err.Error(), Code: "idempotent_replay"})
		return
	case service.IsBusinessError(err):
		respondJSON(w, http.StatusBadRequest, Envelope{Success: false, Error: err.Error(), Code: "business_rule"})
		return
	case strings.Contains(err.Error(), "introuvable"):
		respondJSON(w, http.StatusNotFound, Envelope{Success: false, Error: err.Error()})
	default:
		slog.Error("erreur interne non classée", "error", err)
		respondJSON(w, http.StatusInternalServerError, Envelope{Success: false, Error: "erreur interne"})
	}
}

func decodeBody(r *http.Request, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w2(r), r.Body, 10<<20))
	return dec.Decode(dst)
}

func w2(r *http.Request) http.ResponseWriter { return nil }

func idemKey(r *http.Request) string {
	return r.Header.Get("Idempotency-Key")
}

func pathID(r *http.Request, key string) string {
	return chi.URLParam(r, key)
}

func queryPage(r *http.Request) (page, pageSize int) {
	page, _ = strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ = strconv.Atoi(r.URL.Query().Get("pageSize"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 50
	}
	return
}

// --- pressing settings ---

func (a *API) getSettings(w http.ResponseWriter, r *http.Request) {
	s, err := a.settings.Get(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, s)
}

func (a *API) updateSettings(w http.ResponseWriter, r *http.Request) {
	var s pressing.PressingSettings
	if err := decodeBody(r, &s); err != nil {
		fail(w, fmt.Errorf("corps JSON invalide"))
		return
	}
	updated, err := a.settings.Update(r.Context(), &s)
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, updated)
}

// --- catalog ---

func (a *API) listCatalog(w http.ResponseWriter, r *http.Request) {
	items, err := a.catalog.List(r.Context(), r.URL.Query().Get("includeInactive") != "1")
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, items)
}

func (a *API) saveCatalog(w http.ResponseWriter, r *http.Request) {
	var item pressing.CatalogItem
	if err := decodeBody(r, &item); err != nil {
		fail(w, fmt.Errorf("corps JSON invalide"))
		return
	}
	saved, err := a.catalog.Save(r.Context(), &item)
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, saved)
}

func (a *API) deactivateCatalog(w http.ResponseWriter, r *http.Request) {
	if err := a.catalog.Deactivate(r.Context(), pathID(r, "id")); err != nil {
		fail(w, err)
		return
	}
	ok(w, map[string]bool{"deactivated": true})
}

// --- orders ---

func (a *API) mapping(w http.ResponseWriter, r *http.Request) {
	var req MappingRequest
	if err := decodeBody(r, &req); err != nil {
		fail(w, fmt.Errorf("corps JSON invalide"))
		return
	}
	settings, err := a.settings.Get(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	var client *pressing.Client
	if req.NewClient != nil {
		client = req.NewClient
	} else if req.ClientID != nil && *req.ClientID != "" {
		// aperçu fidèle : solde prépayé et points réels du client
		c, err := a.clients.Get(r.Context(), *req.ClientID)
		if err == nil && c != nil && !c.Archived {
			client = c
		}
	}
	var zone *pressing.DeliveryZone
	if req.DeliveryZoneID != nil && *req.DeliveryZoneID != "" {
		zones, err := a.logistics.Zones(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		for _, z := range zones {
			if z.ID == *req.DeliveryZoneID {
				zone = z
			}
		}
	}
	catalog, err := a.catalog.List(r.Context(), false)
	if err != nil {
		fail(w, err)
		return
	}
	in := req.toPricingInput()
	if client != nil {
		in.ClientID = &client.ID
	}
	res, perr := service.RecalculateOrder(in, settings, client, zone, func(id string) *pressing.CatalogItem {
		for _, c := range catalog {
			if c.ID == id {
				return c
			}
		}
		return nil
	})
	if perr != nil {
		fail(w, perr)
		return
	}
	ok(w, map[string]any{
		"order":             res.Order,
		"actualPrepaidUsed": res.ActualPrepaidUsedFCFA,
		"cashDue":           res.CashDueFCFA,
		"loyaltyDiscount":   res.LoyaltyDiscountFCFA,
	})
}

func (a *API) createOrder(w http.ResponseWriter, r *http.Request) {
	var req MappingRequest
	if err := decodeBody(r, &req); err != nil {
		fail(w, fmt.Errorf("corps JSON invalide"))
		return
	}
	o, err := a.orders.Create(r.Context(), req.toPricingInput(), req.ClaimPhotos, idemKey(r))
	if err != nil {
		fail(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, Envelope{Success: true, Data: o})
}

func (a *API) listOrders(w http.ResponseWriter, r *http.Request) {
	page, pageSize := queryPage(r)
	f := pressing.OrderFilter{
		Status:   r.URL.Query().Get("status"),
		ClientID: r.URL.Query().Get("clientId"),
		Search:   r.URL.Query().Get("search"),
		From:     r.URL.Query().Get("from"),
		To:       r.URL.Query().Get("to"),
		Page:     page,
		PageSize: pageSize,
	}
	if f.From != "" && len(f.From) != 10 || f.To != "" && len(f.To) != 10 {
		fail(w, fmt.Errorf("dates invalides (YYYY-MM-DD)"))
		return
	}
	orders, total, err := a.orders.List(r.Context(), f)
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, map[string]any{"items": orders, "total": total, "page": page, "pageSize": pageSize})
}

func (a *API) getOrder(w http.ResponseWriter, r *http.Request) {
	o, err := a.orders.Get(r.Context(), pathID(r, "id"))
	if err != nil {
		fail(w, err)
		return
	}
	if o == nil {
		respondJSON(w, http.StatusNotFound, Envelope{Success: false, Error: "commande introuvable"})
		return
	}
	ok(w, o)
}

func (a *API) orderPayments(w http.ResponseWriter, r *http.Request) {
	list, err := a.orders.PaymentsOf(r.Context(), pathID(r, "id"))
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, list)
}

func (a *API) addPayment(w http.ResponseWriter, r *http.Request) {
	var req PaymentRequest
	if err := decodeBody(r, &req); err != nil {
		fail(w, fmt.Errorf("corps JSON invalide"))
		return
	}
	o, err := a.orders.AddPayment(r.Context(), pathID(r, "id"), req.AmountFCFA, req.Method, idemKey(r))
	if err != nil {
		if strings.Contains(err.Error(), "introuvable") {
			respondJSON(w, http.StatusNotFound, Envelope{Success: false, Error: "commande introuvable"})
			return
		}
		fail(w, err)
		return
	}
	ok(w, o)
}

func (a *API) advanceStatus(w http.ResponseWriter, r *http.Request) {
	var req StatusRequest
	_ = decodeBody(r, &req)
	o, err := a.orders.AdvanceStatus(r.Context(), pathID(r, "id"), req.Status)
	if err != nil {
		if strings.Contains(err.Error(), "introuvable") {
			respondJSON(w, http.StatusNotFound, Envelope{Success: false, Error: "commande introuvable"})
			return
		}
		fail(w, err)
		return
	}
	ok(w, o)
}

func (a *API) voidOrder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Reason string `json:"reason"`
	}
	if err := decodeBody(r, &req); err != nil {
		fail(w, fmt.Errorf("corps JSON invalide"))
		return
	}
	o, err := a.orders.Void(r.Context(), pathID(r, "id"), req.Reason)
	if err != nil {
		if strings.Contains(err.Error(), "introuvable") {
			respondJSON(w, http.StatusNotFound, Envelope{Success: false, Error: "commande introuvable"})
			return
		}
		fail(w, err)
		return
	}
	ok(w, o)
}

func (a *API) claimPhoto(w http.ResponseWriter, r *http.Request) {
	orderID := pathID(r, "id")
	photoID := pathID(r, "photoId")
	photos, err := a.orders.PhotoBytes(r.Context(), orderID, photoID)
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(photos)
}

// --- clients ---

func (a *API) listClients(w http.ResponseWriter, r *http.Request) {
	page, pageSize := queryPage(r)
	list, total, err := a.clients.List(r.Context(), r.URL.Query().Get("search"), page, pageSize)
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, map[string]any{"items": list, "total": total, "page": page, "pageSize": pageSize})
}

func (a *API) getClient(w http.ResponseWriter, r *http.Request) {
	c, err := a.clients.Get(r.Context(), pathID(r, "id"))
	if err != nil {
		fail(w, err)
		return
	}
	if c == nil {
		respondJSON(w, http.StatusNotFound, Envelope{Success: false, Error: "client introuvable"})
		return
	}
	ok(w, c)
}

func (a *API) saveClient(w http.ResponseWriter, r *http.Request) {
	var c pressing.Client
	if err := decodeBody(r, &c); err != nil {
		fail(w, fmt.Errorf("corps JSON invalide"))
		return
	}
	saved, err := a.clients.Save(r.Context(), &c)
	if err != nil {
		fail(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, Envelope{Success: true, Data: saved})
}

func (a *API) saveClientID(w http.ResponseWriter, r *http.Request) {
	var c pressing.Client
	if err := decodeBody(r, &c); err != nil {
		fail(w, fmt.Errorf("corps JSON invalide"))
		return
	}
	c.ID = pathID(r, "id")
	saved, err := a.clients.Save(r.Context(), &c)
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, saved)
}

func (a *API) topup(w http.ResponseWriter, r *http.Request) {
	var req TopupRequest
	if err := decodeBody(r, &req); err != nil {
		fail(w, fmt.Errorf("corps JSON invalide"))
		return
	}
	in := service.TopupIn{
		AmountFCFA:            req.AmountFCFA,
		BonusFCFA:             req.BonusFCFA,
		Method:                req.Method,
		SubscriptionLabel:     req.SubscriptionLabel,
		SubscriptionExpiresAt: req.SubscriptionExpiresAt,
		Note:                  req.Note,
		IdempotencyKey:        idemKey(r),
	}
	c, err := a.clients.Topup(r.Context(), pathID(r, "id"), in)
	if err != nil {
		if strings.Contains(err.Error(), "introuvable") {
			respondJSON(w, http.StatusNotFound, Envelope{Success: false, Error: "client introuvable"})
			return
		}
		fail(w, err)
		return
	}
	ok(w, c)
}

func (a *API) archiveClient(w http.ResponseWriter, r *http.Request) {
	if err := a.clients.Archive(r.Context(), pathID(r, "id")); err != nil {
		fail(w, err)
		return
	}
	ok(w, map[string]bool{"archived": true})
}

// --- zones & logistics ---

func (a *API) listZones(w http.ResponseWriter, r *http.Request) {
	zones, err := a.logistics.Zones(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, zones)
}

func (a *API) saveZone(w http.ResponseWriter, r *http.Request) {
	var z pressing.DeliveryZone
	if err := decodeBody(r, &z); err != nil {
		fail(w, fmt.Errorf("corps JSON invalide"))
		return
	}
	if err := a.logistics.SaveZone(r.Context(), &z); err != nil {
		fail(w, err)
		return
	}
	ok(w, z)
}

func (a *API) deleteZone(w http.ResponseWriter, r *http.Request) {
	if err := a.logistics.DeleteZone(r.Context(), pathID(r, "id")); err != nil {
		fail(w, err)
		return
	}
	ok(w, map[string]bool{"deleted": true})
}

func (a *API) listLogistics(w http.ResponseWriter, r *http.Request) {
	tasks, err := a.logistics.List(r.Context(),
		r.URL.Query().Get("status"), r.URL.Query().Get("type"), r.URL.Query().Get("date"))
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, tasks)
}

func (a *API) saveTask(w http.ResponseWriter, r *http.Request) {
	var t pressing.LogisticsTask
	if err := decodeBody(r, &t); err != nil {
		fail(w, fmt.Errorf("corps JSON invalide"))
		return
	}
	saved, err := a.logistics.Save(r.Context(), &t)
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, saved)
}

func (a *API) taskStatus(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Status string `json:"status"`
	}
	if err := decodeBody(r, &req); err != nil {
		fail(w, fmt.Errorf("corps JSON invalide"))
		return
	}
	t, err := a.logistics.SetStatus(r.Context(), pathID(r, "id"), pressing.LogisticsStatus(req.Status))
	if err != nil {
		if strings.Contains(err.Error(), "introuvable") {
			respondJSON(w, http.StatusNotFound, Envelope{Success: false, Error: "tâche introuvable"})
			return
		}
		fail(w, err)
		return
	}
	ok(w, t)
}

func (a *API) deleteTask(w http.ResponseWriter, r *http.Request) {
	if err := a.logistics.Delete(r.Context(), pathID(r, "id")); err != nil {
		fail(w, err)
		return
	}
	ok(w, map[string]bool{"deleted": true})
}

// --- inventory ---

func (a *API) listInventory(w http.ResponseWriter, r *http.Request) {
	items, err := a.inventory.List(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, items)
}

func (a *API) saveItem(w http.ResponseWriter, r *http.Request) {
	var i pressing.InventoryItem
	if err := decodeBody(r, &i); err != nil {
		fail(w, fmt.Errorf("corps JSON invalide"))
		return
	}
	saved, err := a.inventory.Save(r.Context(), &i)
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, saved)
}

func (a *API) movement(w http.ResponseWriter, r *http.Request) {
	var req MovementRequest
	if err := decodeBody(r, &req); err != nil {
		fail(w, fmt.Errorf("corps JSON invalide"))
		return
	}
	in := service.MovementIn{
		Type:           req.Type,
		Quantity:       req.Quantity,
		UnitCostFCFA:   req.UnitCostFCFA,
		Reason:         req.Reason,
		RecordExpense:  req.RecordExpense,
		PaymentMethod:  req.PaymentMethod,
		IdempotencyKey: idemKey(r),
	}
	item, err := a.inventory.Movement(r.Context(), pathID(r, "id"), in, a.expenses)
	if err != nil {
		if strings.Contains(err.Error(), "introuvable") {
			respondJSON(w, http.StatusNotFound, Envelope{Success: false, Error: "article introuvable"})
			return
		}
		fail(w, err)
		return
	}
	ok(w, item)
}

func (a *API) listMovements(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	moves, err := a.inventory.Movements(r.Context(), pathID(r, "id"), limit)
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, moves)
}

func (a *API) archiveItem(w http.ResponseWriter, r *http.Request) {
	if err := a.inventory.Archive(r.Context(), pathID(r, "id")); err != nil {
		fail(w, err)
		return
	}
	ok(w, map[string]bool{"archived": true})
}

// --- cashbook ---

func (a *API) listExpenses(w http.ResponseWriter, r *http.Request) {
	page, pageSize := queryPage(r)
	list, total, err := a.cashbook.Expenses(r.Context(),
		r.URL.Query().Get("from"), r.URL.Query().Get("to"), page, pageSize)
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, map[string]any{"items": list, "total": total, "page": page, "pageSize": pageSize})
}

func (a *API) createExpense(w http.ResponseWriter, r *http.Request) {
	var e pressing.ExpenseRecord
	if err := decodeBody(r, &e); err != nil {
		fail(w, fmt.Errorf("corps JSON invalide"))
		return
	}
	saved, err := a.cashbook.CreateExpense(r.Context(), &e)
	if err != nil {
		fail(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, Envelope{Success: true, Data: saved})
}

func (a *API) deleteExpense(w http.ResponseWriter, r *http.Request) {
	if err := a.cashbook.DeleteExpense(r.Context(), pathID(r, "id")); err != nil {
		fail(w, err)
		return
	}
	ok(w, map[string]bool{"deleted": true})
}

// --- reports ---

func (a *API) dailyZ(w http.ResponseWriter, r *http.Request) {
	z, err := a.reports.DailyZ(r.Context(), r.URL.Query().Get("date"))
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, z)
}

func (a *API) monthlyReport(w http.ResponseWriter, r *http.Request) {
	m, err := a.reports.Monthly(r.Context(), r.URL.Query().Get("month"))
	if err != nil {
		fail(w, err)
		return
	}
	ok(w, m)
}
