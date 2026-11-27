// Package http regroupe les handlers HTTP fins (parsing, auth, validation
// transport, appel service, réponse JSON).
package http

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/erwinsskoffi/press_backend/internal/platform/database"
)

// HealthHandlers expose /healthz et /readyz.
type HealthHandlers struct {
	pool *pgxpool.Pool
}

func NewHealthHandlers(pool *pgxpool.Pool) *HealthHandlers {
	return &HealthHandlers{pool: pool}
}

func (h *HealthHandlers) Healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (h *HealthHandlers) Readyz(w http.ResponseWriter, r *http.Request) {
	if err := database.Ready(r.Context(), h.pool); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"status": "unavailable",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ready"})
}

// writeJSON sérialise v avec le statut code.
func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		// trop tard pour changer le code : loggable par middleware
		_ = err
	}
}

// APIError est le format d'erreur uniforme (ADR A11).
type APIError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

type errorEnvelope struct {
	Error APIError `json:"error"`
}

// WriteError écrit l'erreur uniforme. Ne jamais inclure de secret ni de PIN.
func WriteError(w http.ResponseWriter, status int, code, message string, details map[string]any) {
	writeJSON(w, status, errorEnvelope{Error: APIError{Code: code, Message: message, Details: details}})
}

// decodeJSON borne le parsing et refuse les champs inconnus pour éviter les surprises.
func decodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}
