package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/erwinsskoffi/press_backend/internal/backup"
	"github.com/erwinsskoffi/press_backend/internal/domain/pressing"
	"github.com/erwinsskoffi/press_backend/internal/service"
)

// API : handlers REST métier /api/v1 (contrat docs/migration/02-api-contract.md).
// Handlers fins : parsing/validation transport → services → réponse JSON.
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
	backup    *backup.Service
}

func NewAPI(orders *service.OrderService, settings *service.SettingsService, catalog *service.CatalogService,
	clients *service.ClientService, logistics *service.LogisticsService, inventory *service.InventoryService,
	cashbook *service.CashbookService, reports *service.ReportsService, expenses service.ExpenseStore,
	backup *backup.Service) *API {
	return &API{orders, settings, catalog, clients, logistics, inventory, cashbook, reports, expenses, backup}
}

// Routes monte toutes les routes métier du contrat.
func (a *API) Routes(r chi.Router) {
	r.Get("/bootstrap", a.bootstrap)

	// settings
	r.Get("/settings", a.getSettings)
	r.Put("/settings", a.updateSettings)

	// catalog
	r.Get("/catalog", a.listCatalog)
	r.Post("/catalog", a.saveCatalog)
	r.Put("/catalog/{id}", a.saveCatalogID)
	r.Delete("/catalog/{id}", a.deactivateCatalog)

	// clients + wallet
	r.Get("/clients", a.listClients)
	r.Post("/clients", a.saveClient)
	r.Get("/clients/{id}", a.getClient)
	r.Put("/clients/{id}", a.saveClientID)
	r.Delete("/clients/{id}", a.archiveClient)
	r.Post("/clients/{id}/wallet/topups", a.topup)

	// orders
	r.Get("/orders", a.listOrders)
	r.Post("/orders/mapping", a.mapping)
	r.Post("/orders", a.createOrder)
	r.Get("/orders/{id}", a.getOrder)
	r.Get("/orders/{id}/payments", a.orderPayments)
	r.Patch("/orders/{id}/status", a.advanceStatus)
	r.Post("/orders/{id}/payments", a.addPayment)
	r.Post("/orders/{id}/void", a.voidOrder)
	r.Get("/orders/{id}/photos/{photoId}", a.claimPhoto)

	// expenses + reports
	r.Get("/expenses", a.listExpenses)
	r.Post("/expenses", a.createExpense)
	r.Delete("/expenses/{id}", a.deleteExpense)
	r.Get("/reports/daily-z", a.dailyZ)
	r.Get("/reports/monthly", a.monthlyReport)

	// delivery zones
	r.Get("/delivery-zones", a.listZones)
	r.Post("/delivery-zones", a.saveZone)
	r.Put("/delivery-zones/{id}", a.saveZoneID)
	r.Delete("/delivery-zones/{id}", a.deleteZone)

	// logistics
	r.Get("/logistics", a.listLogistics)
	r.Post("/logistics", a.saveTask)
	r.Patch("/logistics/{id}/status", a.taskStatus)
	r.Delete("/logistics/{id}", a.deleteTask)

	// inventory
	r.Get("/inventory", a.listInventory)
	r.Post("/inventory", a.saveItem)
	r.Put("/inventory/{id}", a.saveItemID)
	r.Delete("/inventory/{id}", a.archiveItem)
	r.Get("/inventory/{id}/movements", a.listMovements)
	r.Post("/inventory/{id}/movements", a.movement)

	// backup (export/preview/restore réels — Prompt 07)
	r.Get("/backup/export", a.backupExport)
	r.Post("/backup/preview", a.backupPreview)
	r.Post("/backup/restore", a.backupRestore)
	// sync (préparée ici, finalisée au Prompt 09)
	r.Post("/sync/push", a.notImplemented("sync.push", "Prompt 09"))
	r.Get("/sync/pull", a.notImplemented("sync.pull", "Prompt 09"))
	r.Get("/sync/status", a.notImplemented("sync.status", "Prompt 09"))
}

// --- helpers ---

// failDowngrade : classification uniforme des erreurs (contrat §1).
func fail(w http.ResponseWriter, err error) {
	switch {
	case err == nil:
		return
	case errors.Is(err, service.ErrIdempotentReplay):
		WriteError(w, http.StatusConflict, "conflict", err.Error(), nil)
	case errors.Is(err, service.ErrInvalidAmount), errors.Is(err, service.ErrInvalidQuantity):
		WriteError(w, http.StatusBadRequest, "invalid_request", err.Error(), nil)
	case service.IsBusinessError(err):
		// erreurs métier typées → 422 business_rule
		WriteError(w, http.StatusUnprocessableEntity, "business_rule", err.Error(), nil)
	case errors.Is(err, service.ErrValidation):
		WriteError(w, http.StatusBadRequest, "invalid_request", err.Error(), nil)
	case strings.Contains(err.Error(), "introuvable"):
		WriteError(w, http.StatusNotFound, "not_found", err.Error(), nil)
	case strings.Contains(err.Error(), "déjà appliquée"):
		WriteError(w, http.StatusConflict, "conflict", err.Error(), nil)
	default:
		slog.Error("erreur interne non classée", "error", err)
		WriteError(w, http.StatusInternalServerError, "internal", "Erreur interne.", nil)
	}
}

func decodeBody(w http.ResponseWriter, r *http.Request, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 10<<20))
	if err := dec.Decode(dst); err != nil {
		WriteError(w, http.StatusBadRequest, "invalid_request", "Corps JSON invalide.", nil)
		return err
	}
	return nil
}

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

// requireIdemKey : Idempotency-Key obligatoire (contrat §1) — en-tête
// prioritaire, sinon champ `idempotencyKey` du corps si l'implémentation
// l'a stocké via setIdemBody.
func requireIdemKey(w http.ResponseWriter, r *http.Request) (string, bool) {
	k := idemKey(r)
	if k == "" {
		k = r.Header.Get("X-Idempotency-Body")
	}
	if k == "" {
		WriteError(w, http.StatusBadRequest, "invalid_request",
			"Idempotency-Key requis (en-tête ou champ idempotencyKey).", nil)
		return "", false
	}
	if len(k) > 200 {
		WriteError(w, http.StatusBadRequest, "invalid_request", "Idempotency-Key trop longue.", nil)
		return "", false
	}
	return k, true
}

// --- bootstrap ---

func (a *API) bootstrap(w http.ResponseWriter, r *http.Request) {
	windowDays, _ := strconv.Atoi(r.URL.Query().Get("windowDays"))
	if windowDays < 1 || windowDays > 365 {
		windowDays = 90
	}
	from := time.Now().AddDate(0, 0, -windowDays).Format("2006-01-02")
	to := time.Now().Format("2006-01-02")

	settings, err := a.settings.Get(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	catalog, err := a.catalog.List(r.Context(), false)
	if err != nil {
		fail(w, err)
		return
	}
	zones, err := a.logistics.Zones(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	clients, _, err := a.clients.List(r.Context(), "", 1, 200)
	if err != nil {
		fail(w, err)
		return
	}
	orders, _, err := a.orders.List(r.Context(), pressing.OrderFilter{From: from, To: to, Page: 1, PageSize: 200})
	if err != nil {
		fail(w, err)
		return
	}
	payments, err := a.reports.PaymentsWindow(r.Context(), from, to, 500)
	if err != nil {
		fail(w, err)
		return
	}
	expenses, _, err := a.cashbook.Expenses(r.Context(), from, to, 1, 200)
	if err != nil {
		fail(w, err)
		return
	}
	logistics, err := a.logistics.List(r.Context(), "", "", "")
	if err != nil {
		fail(w, err)
		return
	}
	inventory, err := a.inventory.List(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	movements, err := a.inventory.Movements(r.Context(), "", 500)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"settings": settings, "catalog": catalog, "clients": clients,
		"orders": orders, "payments": payments, "expenses": expenses,
		"zones": zones, "logistics": logistics,
		"inventory": inventory, "inventoryMovements": movements,
		"sync": map[string]any{"cursor": 0, "serverTime": time.Now().UTC().Format(time.RFC3339)},
	})
}

// --- settings ---

func (a *API) getSettings(w http.ResponseWriter, r *http.Request) {
	s, err := a.settings.Get(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s)
}

func (a *API) updateSettings(w http.ResponseWriter, r *http.Request) {
	var s pressing.PressingSettings
	if err := decodeBody(w, r, &s); err != nil {
		return
	}
	updated, err := a.settings.Update(r.Context(), &s)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// --- catalog ---

func (a *API) listCatalog(w http.ResponseWriter, r *http.Request) {
	items, err := a.catalog.List(r.Context(), r.URL.Query().Get("includeInactive") == "1")
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (a *API) saveCatalog(w http.ResponseWriter, r *http.Request) {
	var item pressing.CatalogItem
	if err := decodeBody(w, r, &item); err != nil {
		return
	}
	saved, err := a.catalog.Save(r.Context(), &item)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (a *API) saveCatalogID(w http.ResponseWriter, r *http.Request) {
	var item pressing.CatalogItem
	if err := decodeBody(w, r, &item); err != nil {
		return
	}
	item.ID = pathID(r, "id")
	saved, err := a.catalog.Save(r.Context(), &item)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (a *API) deactivateCatalog(w http.ResponseWriter, r *http.Request) {
	if err := a.catalog.Deactivate(r.Context(), pathID(r, "id")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- orders ---

// mapping : aperçu tarifaire (aucune écriture).
func (a *API) mapping(w http.ResponseWriter, r *http.Request) {
	var req MappingRequest
	if err := decodeBody(w, r, &req); err != nil {
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
		c, err := a.clients.Get(r.Context(), *req.ClientID)
		if err == nil && c != nil && !c.Archived {
			client = c // aperçu fidèle : solde/points réels
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
	res, err := service.RecalculateOrder(in, settings, client, zone, func(id string) *pressing.CatalogItem {
		for _, c := range catalog {
			if c.ID == id {
				return c
			}
		}
		return nil
	})
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *API) createOrder(w http.ResponseWriter, r *http.Request) {
	var req MappingRequest
	if err := decodeBody(w, r, &req); err != nil {
		return
	}
	key := idemKey(r)
	if key == "" && req.IdempotencyKey != "" {
		key = req.IdempotencyKey
	}
	if key == "" {
		WriteError(w, http.StatusBadRequest, "invalid_request",
			"Idempotency-Key requis (en-tête ou champ idempotencyKey).", nil)
		return
	}
	o, err := a.orders.Create(r.Context(), req.toPricingInput(), req.ClaimPhotos, key)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, o)
}

func (a *API) listOrders(w http.ResponseWriter, r *http.Request) {
	page, pageSize := queryPage(r)
	f := pressing.OrderFilter{
		Status:   r.URL.Query().Get("status"),
		ClientID: r.URL.Query().Get("clientId"),
		Search:   r.URL.Query().Get("q"),
		From:     r.URL.Query().Get("from"),
		To:       r.URL.Query().Get("to"),
		Page:     page,
		PageSize: pageSize,
	}
	if f.From != "" && len(f.From) != 10 || f.To != "" && len(f.To) != 10 {
		WriteError(w, http.StatusBadRequest, "invalid_request", "Dates invalides (YYYY-MM-DD).", nil)
		return
	}
	orders, total, err := a.orders.List(r.Context(), f)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": orders, "total": total, "page": page, "pageSize": pageSize})
}

func (a *API) getOrder(w http.ResponseWriter, r *http.Request) {
	o, err := a.orders.Get(r.Context(), pathID(r, "id"))
	if err != nil {
		fail(w, err)
		return
	}
	if o == nil {
		WriteError(w, http.StatusNotFound, "not_found", "Commande introuvable.", nil)
		return
	}
	writeJSON(w, http.StatusOK, o)
}

func (a *API) orderPayments(w http.ResponseWriter, r *http.Request) {
	list, err := a.orders.PaymentsOf(r.Context(), pathID(r, "id"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (a *API) addPayment(w http.ResponseWriter, r *http.Request) {
	var req PaymentRequest
	if err := decodeBody(w, r, &req); err != nil {
		return
	}
	if idemKey(r) == "" && req.IdempotencyKey != "" {
		r.Header.Set("X-Idempotency-Body", req.IdempotencyKey)
	}
	key, okk := requireIdemKey(w, r)
	if !okk {
		return
	}
	o, err := a.orders.AddPayment(r.Context(), pathID(r, "id"), req.AmountFCFA, req.Method, key)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, o)
}

func (a *API) advanceStatus(w http.ResponseWriter, r *http.Request) {
	var req StatusRequest
	_ = decodeBody(w, r, &req) // corps optionnel ({}) : transition implicite acceptée
	o, err := a.orders.AdvanceStatus(r.Context(), pathID(r, "id"), req.Status)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, o)
}

func (a *API) voidOrder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Reason string `json:"reason"`
	}
	if err := decodeBody(w, r, &req); err != nil {
		return
	}
	o, err := a.orders.Void(r.Context(), pathID(r, "id"), req.Reason)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, o)
}

func (a *API) claimPhoto(w http.ResponseWriter, r *http.Request) {
	data, err := a.orders.PhotoBytes(r.Context(), pathID(r, "id"), pathID(r, "photoId"))
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// --- clients ---

func (a *API) listClients(w http.ResponseWriter, r *http.Request) {
	page, pageSize := queryPage(r)
	list, total, err := a.clients.List(r.Context(), r.URL.Query().Get("q"), page, pageSize)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": list, "total": total, "page": page, "pageSize": pageSize})
}

func (a *API) getClient(w http.ResponseWriter, r *http.Request) {
	c, err := a.clients.Get(r.Context(), pathID(r, "id"))
	if err != nil {
		fail(w, err)
		return
	}
	if c == nil {
		WriteError(w, http.StatusNotFound, "not_found", "Client introuvable.", nil)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (a *API) saveClient(w http.ResponseWriter, r *http.Request) {
	var c pressing.Client
	if err := decodeBody(w, r, &c); err != nil {
		return
	}
	saved, err := a.clients.Save(r.Context(), &c)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (a *API) saveClientID(w http.ResponseWriter, r *http.Request) {
	var c pressing.Client
	if err := decodeBody(w, r, &c); err != nil {
		return
	}
	c.ID = pathID(r, "id")
	saved, err := a.clients.Save(r.Context(), &c)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (a *API) topup(w http.ResponseWriter, r *http.Request) {
	var req TopupRequest
	if err := decodeBody(w, r, &req); err != nil {
		return
	}
	key := idemKey(r)
	if key == "" && req.IdempotencyKey != "" {
		key = req.IdempotencyKey
	}
	in := service.TopupIn{
		AmountFCFA:            req.AmountFCFA,
		BonusFCFA:             req.BonusFCFA,
		Method:                req.Method,
		SubscriptionLabel:     req.SubscriptionLabel,
		SubscriptionExpiresAt: req.SubscriptionExpiresAt,
		Note:                  req.Note,
		IdempotencyKey:        key,
	}
	c, err := a.clients.Topup(r.Context(), pathID(r, "id"), in)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (a *API) archiveClient(w http.ResponseWriter, r *http.Request) {
	if err := a.clients.Archive(r.Context(), pathID(r, "id")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- zones & logistics ---

func (a *API) listZones(w http.ResponseWriter, r *http.Request) {
	zones, err := a.logistics.Zones(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, zones)
}

func (a *API) saveZone(w http.ResponseWriter, r *http.Request) {
	var z pressing.DeliveryZone
	if err := decodeBody(w, r, &z); err != nil {
		return
	}
	if err := a.logistics.SaveZone(r.Context(), &z); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, z)
}

func (a *API) saveZoneID(w http.ResponseWriter, r *http.Request) {
	var z pressing.DeliveryZone
	if err := decodeBody(w, r, &z); err != nil {
		return
	}
	z.ID = pathID(r, "id")
	if err := a.logistics.SaveZone(r.Context(), &z); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, z)
}

func (a *API) deleteZone(w http.ResponseWriter, r *http.Request) {
	if err := a.logistics.DeleteZone(r.Context(), pathID(r, "id")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) listLogistics(w http.ResponseWriter, r *http.Request) {
	tasks, err := a.logistics.List(r.Context(),
		r.URL.Query().Get("status"), r.URL.Query().Get("type"), r.URL.Query().Get("date"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tasks)
}

func (a *API) saveTask(w http.ResponseWriter, r *http.Request) {
	var t pressing.LogisticsTask
	if err := decodeBody(w, r, &t); err != nil {
		return
	}
	saved, err := a.logistics.Save(r.Context(), &t)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (a *API) taskStatus(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Status string `json:"status"`
	}
	if err := decodeBody(w, r, &req); err != nil {
		return
	}
	t, err := a.logistics.SetStatus(r.Context(), pathID(r, "id"), pressing.LogisticsStatus(req.Status))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (a *API) deleteTask(w http.ResponseWriter, r *http.Request) {
	if err := a.logistics.Delete(r.Context(), pathID(r, "id")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- inventory ---

func (a *API) listInventory(w http.ResponseWriter, r *http.Request) {
	items, err := a.inventory.List(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (a *API) saveItem(w http.ResponseWriter, r *http.Request) {
	var i pressing.InventoryItem
	if err := decodeBody(w, r, &i); err != nil {
		return
	}
	saved, err := a.inventory.Save(r.Context(), &i)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (a *API) saveItemID(w http.ResponseWriter, r *http.Request) {
	var i pressing.InventoryItem
	if err := decodeBody(w, r, &i); err != nil {
		return
	}
	i.ID = pathID(r, "id")
	saved, err := a.inventory.Save(r.Context(), &i)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (a *API) movement(w http.ResponseWriter, r *http.Request) {
	var req MovementRequest
	if err := decodeBody(w, r, &req); err != nil {
		return
	}
	key := idemKey(r)
	if key == "" && req.IdempotencyKey != "" {
		key = req.IdempotencyKey
	}
	in := service.MovementIn{
		Type:           req.Type,
		Quantity:       req.Quantity,
		UnitCostFCFA:   req.UnitCostFCFA,
		Reason:         req.Reason,
		RecordExpense:  req.RecordExpense,
		PaymentMethod:  req.PaymentMethod,
		IdempotencyKey: key,
	}
	item, err := a.inventory.Movement(r.Context(), pathID(r, "id"), in, a.expenses)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (a *API) listMovements(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	moves, err := a.inventory.Movements(r.Context(), pathID(r, "id"), limit)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, moves)
}

func (a *API) archiveItem(w http.ResponseWriter, r *http.Request) {
	if err := a.inventory.Archive(r.Context(), pathID(r, "id")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
	writeJSON(w, http.StatusOK, map[string]any{"items": list, "total": total, "page": page, "pageSize": pageSize})
}

func (a *API) createExpense(w http.ResponseWriter, r *http.Request) {
	var e pressing.ExpenseRecord
	if err := decodeBody(w, r, &e); err != nil {
		return
	}
	saved, err := a.cashbook.CreateExpense(r.Context(), &e)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (a *API) deleteExpense(w http.ResponseWriter, r *http.Request) {
	if err := a.cashbook.DeleteExpense(r.Context(), pathID(r, "id")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- reports ---

func (a *API) dailyZ(w http.ResponseWriter, r *http.Request) {
	z, err := a.reports.DailyZ(r.Context(), r.URL.Query().Get("date"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, z)
}

func (a *API) monthlyReport(w http.ResponseWriter, r *http.Request) {
	m, err := a.reports.Monthly(r.Context(), r.URL.Query().Get("month"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

// --- backup (export/preview réels ; restore = Prompt 08) ---

// backupExport : export JSON compatible DatabaseBackup v3 (transition frontend).
func (a *API) backupExport(w http.ResponseWriter, r *http.Request) {
	export, err := a.backup.ExportV3(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, export)
}

func (a *API) backupPreview(w http.ResponseWriter, r *http.Request) {
	body, err := readRawBody(w, r)
	if err != nil {
		return
	}
	b, hash, err := backup.Parse(body)
	if err != nil {
		WriteError(w, http.StatusUnprocessableEntity, "business_rule", err.Error(), nil)
		return
	}
	rep, err := a.backup.Preview(r.Context(), b, hash)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rep)
}

// backupRestore : restauration protégée (confirm:true requis) — atomique,
// sauvegarde serveur préalable, hash idempotent.
func (a *API) backupRestore(w http.ResponseWriter, r *http.Request) {
	body, err := readRawBody(w, r)
	if err != nil {
		return
	}
	// confirm peut voyager dans un en-tête (le corps doit rester le backup pur)
	confirm := r.Header.Get("X-Backup-Confirm") == "true"
	b, hash, err := backup.Parse(body)
	if err != nil {
		WriteError(w, http.StatusUnprocessableEntity, "business_rule", err.Error(), nil)
		return
	}
	if !confirm {
		WriteError(w, http.StatusBadRequest, "invalid_request",
			"Confirmation requise : renvoyez la requête avec l'en-tête X-Backup-Confirm: true après avoir consulté le preview.", nil)
		return
	}
	// idempotence : même hash déjà restauré → rapport conservé, aucune réécriture
	if prev, found, err := a.backup.FindImport(r.Context(), hash); err == nil && found && !forceOf(r) {
		prev.Status = "déjà appliqué"
		writeJSON(w, http.StatusOK, prev)
		return
	}
	serverBackup := filepath.Join(a.backup.StorageDir(), "backups",
		"pre-restore-"+time.Now().UTC().Format("20060102T150405")+".json")
	rep, err := a.backup.Restore(r.Context(), b, hash, serverBackup)
	if err != nil {
		writeJSON(w, http.StatusOK, rep) // rapport d'échec détaillé (rien écrit)
		return
	}
	writeJSON(w, http.StatusOK, rep)
}

func forceOf(r *http.Request) bool {
	return r.Header.Get("X-Backup-Force") == "true"
}

func readRawBody(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<20))
	if err != nil {
		WriteError(w, http.StatusBadRequest, "invalid_request", "Corps illisible ou trop volumineux (max 64 Mo).", nil)
		return nil, err
	}
	return raw, nil
}

func (a *API) notImplemented(feature, phase string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		WriteError(w, http.StatusNotImplemented, "not_implemented",
			fmt.Sprintf("%s sera disponible à la phase %s.", feature, phase), nil)
	}
}
