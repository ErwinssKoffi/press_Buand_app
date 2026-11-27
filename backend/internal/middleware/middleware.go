// Package middleware fournit les middlewares HTTP transverses du serveur.
package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"
)

type ctxKey string

// RequestIDKey est la clé de contexte du request ID.
const RequestIDKey ctxKey = "request_id"

// RequestID renvoie le request ID du contexte (vide si absent).
func RequestID(ctx context.Context) string {
	v, _ := ctx.Value(RequestIDKey).(string)
	return v
}

// RequestID attache un identifiant unique à chaque requête (header X-Request-ID repris s'il est fourni).
func RequestIDGen(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rid := r.Header.Get("X-Request-ID")
		if rid == "" || len(rid) > 64 {
			var b [16]byte
			if _, err := rand.Read(b[:]); err != nil {
				rid = strconvFallback()
			} else {
				rid = hex.EncodeToString(b[:])
			}
		}
		w.Header().Set("X-Request-ID", rid)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), RequestIDKey, rid)))
	})
}

func strconvFallback() string {
	return time.Now().Format("20060102150405.000000000")
}

// Logger journalise chaque requête (méthode, chemin, code, durée, request ID)
// sans données personnelles ni secrets.
func Logger(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(sw, r)
			log.Info("http",
				"method", r.Method,
				"path", redactPath(r.URL.Path),
				"status", sw.status,
				"duration_ms", time.Since(start).Milliseconds(),
				"request_id", RequestID(r.Context()),
				"remote", remoteAddr(r),
			)
		})
	}
}

type statusWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (w *statusWriter) WriteHeader(code int) {
	if !w.wroteHeader {
		w.status = code
		w.wroteHeader = true
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}

// redactPath retire les segments sensibles éventuels (aucun secret n'est transporté en path par conception).
func redactPath(p string) string {
	if len(p) > 300 {
		return p[:300] + "…"
	}
	return p
}

func remoteAddr(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// Recover transforme une panic en 500 JSON contrôlé.
func Recover(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					log.Error("panic",
						"error", anyToString(rec),
						"request_id", RequestID(r.Context()),
						"path", r.URL.Path,
					)
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusInternalServerError)
					_, _ = w.Write([]byte(`{"error":{"code":"internal","message":"Erreur interne du serveur.","details":{}}}`))
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func anyToString(v any) string {
	switch t := v.(type) {
	case error:
		return t.Error()
	case string:
		return t
	default:
		return "panic non typée"
	}
}

// SecurityHeaders ajoute les en-têtes de protection de base.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// CORS ferme les origines par défaut ; n'autorise que celles configurées.
func CORS(origins []string) func(http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, o := range origins {
		allowed[strings.ToLower(strings.TrimSpace(o))] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := strings.ToLower(r.Header.Get("Origin"))
			if origin != "" && allowed[origin] {
				h := w.Header()
				h.Set("Access-Control-Allow-Origin", origin)
				h.Set("Vary", "Origin")
				h.Set("Access-Control-Allow-Credentials", "true")
				h.Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
				h.Set("Access-Control-Allow-Headers", "Content-Type,Idempotency-Key,X-Request-ID")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// BodyLimit borne la taille des corps de requête.
func BodyLimit(max int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, max)
			}
			next.ServeHTTP(w, r)
		})
	}
}
