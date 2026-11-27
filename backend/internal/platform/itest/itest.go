// Package itest fournit des utilitaires partagés aux tests d'intégration :
// verrou inter-process pour sérialiser l'accès à la base de test.
package itest

import (
	"os"
	"syscall"
	"testing"
)

// LockTestDB prend un verrou exclusif sur /tmp/eclat_it.lock pour la durée du test
// (les packages de test s'exécutent en parallèle sur la même base dédiée).
func LockTestDB(t *testing.T) {
	t.Helper()
	f, err := os.OpenFile("/tmp/eclat_it.lock", os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		t.Fatalf("verrou test DB: %v", err)
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		f.Close()
		t.Fatalf("flock: %v", err)
	}
	t.Cleanup(func() {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		_ = f.Close()
	})
}
