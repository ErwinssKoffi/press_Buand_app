module github.com/erwinsskoffi/press_backend

go 1.27

require (
	github.com/go-chi/chi/v5 v5.5.0
	github.com/google/uuid v1.6.0
	github.com/jackc/pgx/v5 v5.13.0
	golang.org/x/crypto v0.59.0
)

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.3 // indirect
	golang.org/x/sync v0.25.0 // indirect
	golang.org/x/sys v0.50.0 // indirect
	golang.org/x/text v0.44.0 // indirect
)

// Remplacements pour environnements à réseau restreint : les modules dont le
// chemin canonique (golang.org/*) n'est pas joignable sont servis par leur
// dépôt GitHub officiel, qui déclare exactement ce chemin de module.
// NB: gopkg.in/yaml.v3 (tests d'une dépendance indirecte) n'est pas requis
// pour compiler le backend.
replace (
	golang.org/x/crypto => github.com/golang/crypto v0.59.0
	golang.org/x/sync => github.com/golang/sync v0.25.0
	golang.org/x/sys => github.com/golang/sys v0.50.0
	golang.org/x/text => github.com/golang/text v0.44.0
)
