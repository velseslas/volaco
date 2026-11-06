# VibeCode Studio Core (volaco-core)

Plateforme **AI-Native Software Engineering & Design** locale : création, compréhension, modification, audit et amélioration continue d'applications web par conversation naturelle.

> Understand. Build. Validate. Deploy. Audit. Evolve. — CDC V7.0/V8.1

## Démarrage rapide

```bash
npm install
npm run build          # tsc -> dist/
npm start              # node dist/apps/api/src/server.js (port 3000)
# ou sous Windows :
.\start-vibecode.ps1
```

- **Studio** : http://127.0.0.1:3000/
- **Healthcheck** : http://127.0.0.1:3000/health
- **Métriques** : http://127.0.0.1:3000/metrics

## Configuration (`.env`, voir `.env.example`)

| Variable | Rôle |
|---|---|
| `MISTRAL_API_KEY` | Clé Mistral/Codestral pour le moteur IA (serveur uniquement) |
| `GEMINI_API_KEY` | Fournisseur alternatif (Provider Independence — §3.8 CDC) |
| `VOLACO_API_KEY` | Clé d'API admin (Bearer). Absente en production → clé éphémère |
| `VOLACO_JWT_SECRET` | **Secret HMAC dédié à la signature des JWT (OBLIGATOIRE).** Base64 canonique ≥ 32 octets, distinct de `VOLACO_API_KEY`. Absent/invalide → **le service refuse de démarrer**. Voir `.env.example` [SEC-001] |
| `VOLACO_STRICT_AUTH` | `1` = mode strict (repli dev par en-têtes désactivé). En production, le strict est **imposé** ; `0` n'est honoré qu'en dev/test |
| `AUTH_SECRET` | **Historique** : ne signe plus les JWT (remplacé par `VOLACO_JWT_SECRET`). Sert encore à dériver la clé d'API de production. Ne pas réutiliser comme secret JWT |
| `CORS_ALLOWED_ORIGINS` | Origines cross-origin autorisées (vide = même origine uniquement) |
| `VOLACO_PERSISTENCE` | `json` force le backend fichiers hérité (défaut : SQLite) |
| `VOLACO_DATA_DIR` | Répertoire des données (défaut : `.volaco-data/`) |
| `VOLACO_MATERIALIZE` | `0` désactive la réplication disque des fichiers projets |

## Commandes

| Commande | Rôle |
|---|---|
| `npm run build` | Compilation TypeScript |
| `npm test` | Suite complète (isolée : répertoire de données temporaire par exécution) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run security:check` | Scan anti-fuite de secrets (aussi en hook pre-commit) |
| `npm run gate1:verify` / `gate2:verify` | Quality Gates historiques |

## Architecture

```
apps/
  api/     → HTTP : mini-routeur déclaratif + routes (conversation SSE,
             audit 8 dimensions, features/feedback/strategy, decide, orchestrate,
             render headless Chromium, DNA, visual-critic, design, repair, auth JWT)
  studio/  → UI single-file (chat streaming, preview, explorer, terminal,
             timeline/révisions, audit, features, feedback, strategy, DNA)
packages/core/
  ai-native/ → moteurs : conversation-intelligence, agent-runtime, orchestrator,
             decision-engine, application-audit, feature/feedback-intelligence,
             design-harmony, visual-intelligence, mutation-orchestrator, …
  persistence/ → SQLite (node:sqlite) derrière l'API historique JSON
  terminal/  → whitelist stricte (execFileSync sans shell, no RCE)
```

## Sécurité

- Auth JWT par utilisateur, un tenant dédié par compte (isolation cross-tenant testée).
- Fallback dev : headers `X-Tenant-Id`/`X-User-Role` (jamais en production).
- Terminal : binaires whitelistés, sous-commandes RCE bloquées (`npm install/run`, `node -e`), exécution sans shell.
- Rate limiting : 600 req/min/IP (API), 60 req/min/IP (proxy IA).
- Anti-fuite de secrets en pre-commit (`scripts/check-secrets.mjs`).

## Documentation

- Cahier des charges : `docs/` (V7.0 final, V8.1 unified, V8.0 Design Intelligence)
- Historique d'audits sécurité : `docs/security-audit/`
- Décisions d'architecture : `docs/adr/`

## Statut

Voir `RAPPORT-AUDIT-20260926.md` (audit initial) et l'historique git pour la
série de correctifs « fondations » (blindage, routeur, SQLite, auth, UI §42,
fichiers disque, self-repair, design intelligence).
