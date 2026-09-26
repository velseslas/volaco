# POST-REMEDIATION INDEPENDENT SECURITY AUDIT
## EXECUTIVE SUMMARY — VOLACO-CORE

**Date de l'audit :** 11 Septembre 2026  
**Équipe d'audit :** Security Engineering & Independent Red Team  
**Méthodologie :** Audit boîte blanche intégral, analyse de flux de données, tests offensifs dynamiques  
**Périmètre :** Monorepo complet `volaco-core` (`apps/api`, `apps/studio`, `packages/core`)  

---

### 1. Synthèse Globale

À la suite de l'autopsie Red Team initiale (Score : **48.5/100 — CRITIQUE**) et du déploiement des lots de remédiation **P0-001** et **P0-002** (annonçant un score de **96.2/100**), un audit post-remédiation indépendant et contradictoire a été exécuté sur l'intégralité du code source réel.

Cet audit a appliqué le principe fondamental : **ZERO ASSUMPTION — NO EVIDENCE → NO CLAIM**.
Aucune affirmation issue des précédents rapports n'a été acceptée sans vérification directe dans l'arbre syntaxique, l'exécution et les tests offensifs.

### 2. Résultats Clés

1. **Éradication des failles P0 critiques réelles :**
   - **SEC-001 (Clé JWT par défaut) :** Définitivement éliminée (`validateAuthSecret` refuse tout démarrage avec secret < 32 chars).
   - **SEC-002 (Bypass Auth par Headers) :** Définitivement bloqué sur les routes privées (exigence systématique du token Bearer HMAC-SHA256).
   - **SEC-003 (Clé Mistral en clair) :** Définitivement retirée du frontend et du `localStorage` ; relais via proxy serveur sécurisé.
   - **SEC-007 (Iframe Preview `allow-same-origin`) :** Définitivement neutralisée (`sandbox` sans `allow-same-origin`, origine opaque).

2. **Écarts majeurs découverts entre le score annoncé (96.2) et la réalité du code :**
   - **5 vulnérabilités identifiées lors de l'audit initial sont en réalité `NOT_FIXED` :**
     - `SEC-005` (Path traversal distribution statique par `!includes('..')` sans vérification canonique).
     - `SEC-006` (Volatilité intégrale des stores mémoire non persistés).
     - `SEC-014` (Absence de signature cryptographique sur l'AuditStore).
     - `SEC-015` (Exposition publique sans authentification de `/metrics` et `/api/v1/metrics`).
     - `SEC-016` (Usurpation d'auteur de révision via `payload.author` non corrélé au JWT).
   - **4 vulnérabilités traitées sont seulement `PARTIALLY_FIXED` :**
     - `SEC-013` (Rate limiting : contournable par spoofing `X-Forwarded-For` en l'absence de reverse proxy de confiance ; fuite mémoire potentielle dans la table de buckets ; `readBody` par défaut à 10 Mo au lieu de 1 Mo).
     - `SEC-009` (Agent Runtime : les mutations destructives `allowBreaking` et `allowHighRisk` par défaut à `true` pour les ingénieurs sans confirmation humaine ou approbation admin).
     - `SEC-010` (Prompt Injection : serveur proxy protégé par délimiteurs XML `<user_input>`, mais Studio client concatène toujours en clair `uPrompt` et injecte le HTML IA directement dans le DOM de prévisualisation).
     - `SEC-011` (SRI CDN : bibliothèques tierces protégées par SHA-512, mais repli Tailwind CDN `cdn.tailwindcss.com` non haché).
   - **Nouvelle anomalie d'architecture découverte :**
     - Endpoint public `POST /api/v1/auth/session` et injection HTML à la racine `/` distribuant sans authentification des tokens avec le rôle `ENGINEER` sur le tenant `default-tenant`.

### 3. Tableau Récapitulatif des 16 Findings

| Réf | Sévérité Initiale | Intitulé | Statut Vérifié | Risque Résiduel |
| :--- | :---: | :--- | :---: | :--- |
| **SEC-001** | CRITIQUE | Clé secrète JWT par défaut codée en dur | **FIXED** | Négligeable |
| **SEC-002** | CRITIQUE | Bypass authentification par en-têtes HTTP | **FIXED** | Faible (Token default-tenant public) |
| **SEC-003** | CRITIQUE | Clé Mistral exposée dans HTML / localStorage | **FIXED** | Négligeable |
| **SEC-004** | ÉLEVÉ | CORS permissif avec wildcard `*` | **FIXED** | Négligeable |
| **SEC-005** | MOYEN | Path traversal sur distribution statique | **NOT_FIXED** | Moyen |
| **SEC-006** | MOYEN | Volatilité totale des stores mémoire | **NOT_FIXED** | Moyen (Dette architecturale) |
| **SEC-007** | CRITIQUE | Évasion Sandbox Iframe via `allow-same-origin` | **FIXED** | Négligeable |
| **SEC-008** | ÉLEVÉ | Popout preview Blob sans `noopener noreferrer` | **FIXED** | Négligeable |
| **SEC-009** | ÉLEVÉ | Forçage autonome mutations `allowBreaking` | **PARTIALLY_FIXED** | Moyen |
| **SEC-010** | ÉLEVÉ | Concaténation non assainie prompt LLM | **PARTIALLY_FIXED** | Moyen |
| **SEC-011** | ÉLEVÉ | Dépendances CDN externes sans hash SRI | **PARTIALLY_FIXED** | Faible |
| **SEC-012** | MOYEN | Omission masquage mots de passe `DATABASE_URL` | **FIXED** | Négligeable |
| **SEC-013** | ÉLEVÉ | DoS & Absence de Rate Limiting effectif | **PARTIALLY_FIXED** | Élevé |
| **SEC-014** | MOYEN | Absence signature / non-répudiation AuditStore | **NOT_FIXED** | Faible-Moyen |
| **SEC-015** | FAIBLE | Exposition publique `/metrics` sans auth | **NOT_FIXED** | Faible |
| **SEC-016** | MOYEN | Usurpation auteur révision via `payload.author` | **NOT_FIXED** | Moyen |

---

### 4. Recomputation du Score de Sécurité

* Score initial (Autopsie Red Team) : **48.5 / 100**
* Score P0-001 (annoncé) : **85.5 / 100**
* Score P0-002 (annoncé) : **96.2 / 100**
* **Score Réellement Vérifié :** **81.5 / 100 — POSTURE MODÉRÉE / HYGIÈNE RENFORCÉE**

La divergence de **-14.7 points** entre le score annoncé (96.2) et le score vérifié (81.5) s'explique par la prise en compte objective des 5 findings non traités (SEC-005, SEC-006, SEC-014, SEC-015, SEC-016), des vulnérabilités de contournement du Rate Limiter (IP spoofing), et du comportement permissif par défaut de l'exécuteur agentique.

---

### 5. Verdict de Production

# 🟡 CONDITIONAL GO STRICT

**Justification du verdict :**
1. **Pourquoi pas NO-GO ?** Aucune des failles critiques permettant une prise de contrôle totale inter-tenants, une fuite de clé secrète système ou une évasion de bac à sable frontend n'est actuellement exploitable. L'étanchéité multi-tenant et le RBAC de base sont effectifs.
2. **Pourquoi pas GO ?** Le système ne peut pas être exposé directement sur l'Internet public sans reverse proxy durci en raison des faiblesses sur le Rate Limiting (IP spoofing via `X-Forwarded-For`), de l'absence de nettoyage des buckets mémoire (Heap DoS), et du token `default-tenant` auto-délivré aux utilisateurs anonymes.
3. **Conditions pour la reprise fonctionnelle (AINT-017) :**
   - Développement d'AINT-017 **AUTORISÉ** en environnement isolé de staging / dev.
   - Avant toute mise en production externe : exécution obligatoire du lot de remédiation **P1-001** (sécurisation du proxy Rate Limiter, assainissement strict des chemins statiques, et liaison de l'auteur de révision au token JWT).
