# EXECUTIVE SUMMARY — AUTOPSIE DE SÉCURITÉ VOLACO

**Date d'audit :** 11 Septembre 2026  
**Équipe d'audit :** Security Engineering & Red Team Volaco  
**Version évaluée :** Socle pré-AINT-017 (POST GATE 2 - 1094 tests)  
**Périmètre :** `apps/api`, `apps/studio`, `packages/core` (Monorepo complet)  
**Engagement :** Audit offensif statique et dynamique sans modification de code applicatif.

---

## 1. Score Global de Sécurité & Risque

```
========================================================================================
                          SCORE DE SÉCURITÉ OFFENSIF GLOBAL
========================================================================================

           SCORE GLOBAL FACTUEL : 48.5 / 100  (NIVEAU DE RISQUE : CRITIQUE)
             VERDICT POUR DÉPLOIEMENT EN PRODUCTION : NO-GO STRICT

  • D1. Authentification & Gestion des Jetons  : 15 / 100  (Bypass en-têtes & JWT fixe)
  • D2. Contrôle d'Accès (RBAC) & Multi-Tenant : 20 / 100  (Élévation OWNER sans token)
  • D3. Isolation Host & Processus Système     : 100 / 100 (Safe by Design, zéro shell)
  • D4. Confinement Sandbox Preview (Client)   : 20 / 100  (Évasion sandbox confirmée)
  • D5. Sécurité de l'Agent Runtime & Outils   : 60 / 100  (Mutations forcées sans gate)
  • D6. Gestion des Secrets & Données Clés     : 25 / 100  (Clé Mistral publique)
  • D7. Résilience DoS & Quotas Mémoire        : 30 / 100  (Crash OOM Node.js immédiat)
  • D8. Intégrité FileStore Virtuel & DAG      : 95 / 100  (SanitizePath & Kahn étanches)

========================================================================================
```

---

## 2. Synthèse des Vulnérabilités Identifiées

L'autopsie a documenté et prouvé **16 vulnérabilités factuelles** (aucun faux positif) :

* **P0 — CRITIQUE (4) :**
  - **SEC-001 :** Clé secrète JWT par défaut codée en dur dans le code source (`apps/api/src/middleware/auth.ts:18`).
  - **SEC-002 :** Contournement complet de l'authentification par en-têtes HTTP en mode par défaut (`apps/api/src/middleware/auth.ts:108-125`).
  - **SEC-003 :** Clé API Mistral de production publique dans le code client HTML (`apps/studio/index.html:3092`).
  - **SEC-007 :** Évasion de sandbox iframe client via combinaison `allow-scripts` et `allow-same-origin` (`apps/studio/index.html:1402`).

* **P1 — ÉLEVÉ (6) :**
  - **SEC-004 :** Configuration CORS avec repli permissif `Access-Control-Allow-Origin: *` (`apps/api/src/server.ts:41-46`).
  - **SEC-008 :** Popout Preview Blob URL ouvert sans `noopener noreferrer` (`apps/studio/index.html:4789`).
  - **SEC-009 :** Forçage autonome des mutations destructives (`allowBreaking: true, allowHighRisk: true`) (`packages/core/src/ai-native/agent-runtime/execution/executor.ts:104`).
  - **SEC-010 :** Concaténation non assainie du prompt utilisateur vers le LLM (`apps/studio/index.html:9691`).
  - **SEC-011 :** Dépendances CDN externes chargées sans hash Subresource Integrity (SRI) (`apps/studio/index.html:8-33`).
  - **SEC-013 :** Absence de Rate Limiting et vulnérabilité d'épuisement de tas RAM Heap DoS (`apps/api/src/middleware/auth.ts:134`).

* **P2 — MOYEN (4) :**
  - **SEC-005 :** Validation sommaire de path traversal dans le serveur de fichiers statiques (`apps/api/src/server.ts:95-97`).
  - **SEC-006 :** Volatilité intégrale des stores mémoire (`FileStore`, `AuditStore`, `ProjectStore`).
  - **SEC-012 :** Omission du masquage des mots de passe dans les variables `DATABASE_URL` (`packages/core/src/settings/service.ts:13`).
  - **SEC-014 :** Absence de signature cryptographique et de non-répudiation sur l'AuditStore (`packages/core/src/observability/audit.ts`).

* **P3 — FAIBLE (2) :**
  - **SEC-015 :** Exposition publique de statistiques globales inter-tenants sur `/metrics` (`apps/api/src/routes/observability.ts:16`).
  - **SEC-016 :** Usurpation de l'auteur d'une révision via le champ client `payload.author` (`apps/api/src/routes/revisions.ts:58`).

---

## 3. Pourquoi l'estimation initiale était à ~52/100 et le score réel à 48.5/100

L'estimation externe préliminaire de **52/100** reposait sur une vision partielle :
1. **Les points forts réels qui donnaient confiance :** Le moteur interne est dépourvu d'appels `child_process`, le terminal est émulé, et le FileStore virtuel empêche le path traversal `..`.
2. **Ce que l'estimation externe n'avait pas détecté (-3.5 points) :**
   - Le fait que `apps/api/src/middleware/auth.ts` autorise l'authentification par en-têtes sans signature cryptographique dès que `process.env.NODE_ENV` est `undefined` (le comportement Node standard par défaut).
   - Le fait que la clé API Mistral dans `index.html` est une vraie clé d'entreprise active persistée dans le `localStorage`.
   - Le fait que l'iframe du client Studio utilise à la fois `allow-scripts` et `allow-same-origin`, permettant au code généré de briser le confinement et de manipuler le Studio parent.

---

## 4. Recommandation Majeure de la Red Team

**Interdiction formelle de déployer en production ou de poursuivre le développement fonctionnel d'AINT-017 tant que le Sprint de Sécurisation d'Urgence P0 (correctifs SEC-001, SEC-002, SEC-003, SEC-007) n'a pas été appliqué et re-testé par l'équipe Red Team.**
