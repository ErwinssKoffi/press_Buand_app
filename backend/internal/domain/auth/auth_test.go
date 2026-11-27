package auth

import (
	"strings"
	"testing"
)

func TestHashSecretVerifyRoundtrip(t *testing.T) {
	hash, err := HashSecret("48291")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$") {
		t.Fatalf("format PHC inattendu: %q", hash)
	}
	if !VerifyPHC("48291", hash) {
		t.Fatal("le bon secret doit être vérifié")
	}
	if VerifyPHC("48292", hash) {
		t.Fatal("un mauvais secret ne doit pas passer")
	}
}

func TestLegacyHashVectors(t *testing.T) {
	// Vecteurs générés depuis src/utils/pinAuth.ts (Web Crypto SHA-256) — compat exacte.
	cases := []struct {
		pin, salt, want string
	}{
		{
			"12345", "abcdef0123456789abcdef0123456789",
			"d654afda448594ce6131fa1ec95ba092404824bfde52e2ecc011ab6182c91099",
		},
		{
			"00000", "deadbeefdeadbeefdeadbeefdeadbeef",
			"ce33b654b8b2ca2629ee21c1c9ecb6d530e354d4ea7743631aa5a0749a5e410e",
		},
	}
	for _, c := range cases {
		if got := LegacyHash(c.pin, c.salt); got != c.want {
			t.Errorf("LegacyHash(%s,%s)=%q attendu %q", c.pin, c.salt, got, c.want)
		}
	}
}

func TestValidateSecret(t *testing.T) {
	if err := ValidateSecret("48291", true); err != nil {
		t.Errorf("PIN 5 chiffres doit passer en LAN: %v", err)
	}
	if err := ValidateSecret("48291", false); err == nil {
		t.Error("PIN 5 chiffres doit être refusé hors LAN")
	}
	if err := ValidateSecret("Mot2Passe.Long", false); err != nil {
		t.Errorf("secret fort doit passer: %v", err)
	}
	for _, weak := range []string{"court", "12345678", "abcdefgh"} {
		if err := ValidateSecret(weak, false); err == nil {
			t.Errorf("%q doit être refusé hors LAN", weak)
		}
	}
}

func TestNewTokenUniqueAndHashed(t *testing.T) {
	a, _ := NewToken()
	b, _ := NewToken()
	if a == b {
		t.Fatal("jetons doivent être uniques")
	}
	if TokenHash(a) == TokenHash(b) {
		t.Fatal("hashes doivent différer")
	}
	if TokenHash(a) != TokenHash(a) {
		t.Fatal("hash doit être déterministe")
	}
	if len(TokenHash(a)) != 64 {
		t.Fatalf("SHA-256 hex = 64 caractères, obtenu %d", len(TokenHash(a)))
	}
}
