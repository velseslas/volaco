# ADR-004 — Terminal : whitelist fermée, exécution sans shell

**Décision :** le terminal web (CORE-005) n'exécute que pnpm/npm/node/git avec
des sous-commandes fermées (test/build/lint/--version, git status/log/diff/
branch/show), via `execFileSync` SANS shell. Les fichiers projets sont
matérialisés dans workspace/<tenant>/<projectId>/ (ÉTAPE 6) et servent de cwd.

**Contexte :** `npm install/run` exécute du code arbitraire (hooks, scripts) ;
`node -e` évalue du code arbitraire ; Windows réserve en plus des surprises
(npm = npm.cmd) — tout est bloqué ou annoncé honnêtement.

**Alternatives :** conteneurs/Firecracker (CDC §24 — Phase 5, quand le
multi-tenant réel le justifiera) ; shell:true + filtre (rejeté : injection).

**Conséquences :** pas d'install de paquets ni de builds réels dans les projets
générés pour l'instant ; chaque refus est explicite et audité ; la porte reste
ouverte à une sandbox isolée (§24) sans changer la whitelist.

**Statut :** ACTIVE
