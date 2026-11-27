// Package ids fournit les identifiants UUIDv7 (triables, non prévisibles, compatibles outbox).
package ids

import (
	"github.com/google/uuid"
)

// NewUUID renvoie un UUIDv7, avec repli UUIDv4.
func NewUUID() string {
	if id, err := uuid.NewV7(); err == nil {
		return id.String()
	}
	return uuid.NewString()
}
