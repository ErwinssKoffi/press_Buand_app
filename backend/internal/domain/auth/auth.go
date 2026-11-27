// Package auth porte les règles d'authentification : hash Argon2id,
// compatibilité legacy SHA-256 (PIN navigateur), politique de secret et
// verrouillage. Aucune dépendance HTTP ni SQL ici.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"
)

var (
	ErrAlreadySetup  = errors.New("credentials déjà configurés")
	ErrWeakSecret    = errors.New("secret trop faible")
	ErrLocked        = errors.New("compte temporairement verrouillé")
	ErrInvalidSecret = errors.New("secret invalide")
	ErrUnauthorized  = errors.New("session absente ou invalide")
)

// Params Argon2id (documentés, configurables raisonnablement).
const (
	argonTime    = 1
	argonMemory  = 64 * 1024 // KiB (64 Mo)
	argonThreads = 4
	argonKeyLen  = 32
	argonSaltLen = 16
)

// LegacySuffix : suffixe exact du hash navigateur historique (src/utils/pinAuth.ts).
const LegacySuffix = "eclat-pressing-pin-v1"

var fiveDigitRe = regexp.MustCompile(`^\d{5}$`)

// Policy décrit la politique locale d'authentification.
type Policy struct {
	MaxAttempts  int           // échecs avant lockout
	Lockout      time.Duration // durée du lockout persistant
	AllowWeakPIN bool          // PIN 5 chiffres autorisé (mono-poste / LAN)
	SessionTTL   time.Duration
}

// HashSecret hache un secret avec Argon2id et renvoie une chaîne PHC.
func HashSecret(secret string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(secret), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// VerifyPHC vérifie un secret contre une chaîne PHC Argon2id (temps constant).
func VerifyPHC(secret, phc string) bool {
	parts := strings.Split(phc, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false
	}
	var m uint32
	var t uint32
	var p uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	key, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}
	candidate := argon2.IDKey([]byte(secret), salt, t, m, p, uint32(len(key)))
	return subtle.ConstantTimeCompare(candidate, key) == 1
}

// LegacyHash reproduit exactement le hash navigateur historique :
// SHA-256("salt:pin:eclat-pressing-pin-v1") en hexadécimal.
// Utilisé UNIQUEMENT pour la transition (vérification puis re-hash Argon2id).
func LegacyHash(pin, salt string) string {
	payload := salt + ":" + pin + ":" + LegacySuffix
	sum := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(sum[:])
}

// ValidateSecret applique la politique : PIN 5 chiffres si autorisé,
// sinon secret d'au moins 8 caractères mêlant lettres et chiffres.
func ValidateSecret(secret string, allowWeakPIN bool) error {
	if allowWeakPIN && fiveDigitRe.MatchString(secret) {
		return nil
	}
	if len(secret) < 8 {
		return ErrWeakSecret
	}
	hasLetter := false
	hasDigit := false
	for _, r := range secret {
		switch {
		case r >= '0' && r <= '9':
			hasDigit = true
		case (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z'):
			hasLetter = true
		}
	}
	if !hasLetter || !hasDigit {
		return ErrWeakSecret
	}
	return nil
}

// NewToken génère un jeton de session opaque (32 octets aléatoires).
func NewToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// TokenHash : seul le hash SHA-256 du jeton est persisté.
func TokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
