# ADR — VibeCode Studio (volaco-core)

Mémoire architecturale officielle (CDC V7.0 Annexe L : « Tout choix
architectural majeur doit être documenté sous forme d'ADR »).

| ADR | Décision | Statut |
|---|---|---|
| [ADR-001](./ADR-001-persistence-sqlite.md) | SQLite (node:sqlite) comme persistance durable, PostgreSQL reporté au scale | ACTIVE |
| [ADR-002](./ADR-002-jwt-per-user-tenants.md) | Auth JWT par utilisateur, un tenant dédié par compte, clé admin réservée | ACTIVE |
| [ADR-003](./ADR-003-csp-deferred-srcdoc.md) | CSP différée tant que le preview utilise un iframe srcdoc (exception Annexe F documentée) | ACTIVE |
| [ADR-004](./ADR-004-terminal-whitelist-no-shell.md) | Terminal : whitelist fermée + execFileSync sans shell (pas de matérialisation requise pour --version) | ACTIVE |
