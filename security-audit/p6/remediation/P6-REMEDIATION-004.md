# RAPPORT DE REMÉDIATION — P6-REMEDIATION-004

## VULNÉRABILITÉ : P6-VULN-04 — AI Status Endpoint Self-DoS / Quota Collision

* **Projet** : Volaco Core
* **Mission** : P6-REMEDIATION-004
* **Date** : 12 Septembre 2026
* **Sévérité** : MEDIUM (CVSS v3.1: 6.5 / CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:H)
* **Auteur / Évaluateur** : Équipe Sécurité Offensive & Red Team Volaco
* **Statut Final** : **FIXED**

---

## 1. EXECUTIVE SUMMARY

Pendant la campagne **P6 Independent Final Red Team / Zero-Day Hunt**, une faille de collision de quota a été identifiée entre l'endpoint de diagnostic / statut de disponibilité du service d'intelligence artificielle et l'endpoint de complétion de code :

* **Comportement vulnérable constaté** :
  Le middleware de limitation de débit (RateLimiter) classait indifféremment toute route répondant à isAiRoute(pathname) dans le tier AI (AI_TIER_LIMIT = 20 req/min), sans tenir compte de la sémantique de l'endpoint ni de la méthode HTTP employée.
  Par conséquent, l'endpoint de lecture / diagnostic GET /api/v1/ai/status (et /ai/status) consommait le même bucket de quota que POST /api/v1/ai/chat/completions.
* **Impact** :
  Un polling régulier par une interface de surveillance, un tableau de bord Studio ou un tiers non malveillant (ex: 20 requêtes GET /api/v1/ai/status par minute) épuisait l'intégralité du quota de complétion. Toute requête utilisateur subséquente sur POST /api/v1/ai/chat/completions était alors rejetée avec HTTP 429 (TOO_MANY_REQUESTS), provoquant un déni de service auto-infligé immédiat sur les fonctionnalités d'IA.
* **Remédiation appliquée** :
  La classification des tiers a été corrigée dans pps/api/src/middleware/rate-limiter.ts. Les routes de diagnostic en lecture seule (GET /api/v1/ai/status et GET /ai/status) sont désormais orientées vers le tier DEFAULT (120 req/min), tandis que les complétions IA et les opérations mutatives demeurent strictement protégées dans le tier AI (20 req/min).

---

## 2. VULNÉRABILITÉ ORIGINALE & ROOT CAUSE

### 2.1 Description
L'endpoint GET /api/v1/ai/status est un endpoint public et léger renvoyant la disponibilité du modèle et la configuration serveur de Mistral.
Avant correction, le middleware exécutait :

`	ypescript
// AVANT (Vulnérable aux collisions de compteurs)
public resolveTier(method: string = 'GET', pathname: string = '/'): RateLimitTier {
  const upperMethod = (method || 'GET').toUpperCase();
  if (this.isAiRoute(pathname)) {
    return 'AI'; // <-- TOUTE route sous /api/v1/ai/ ou /ai/ devenait 'AI', y compris les requêtes de diagnostic
  }
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(upperMethod)) {
    return 'MUTATION';
  }
  return 'DEFAULT';
}
`

### 2.2 Preuve comportementale du partage de bucket (BEFORE)
Avant remédiation, l'exécution du script de reproduction a démontré :
* GET /api/v1/ai/status $\rightarrow$ tier AI.
* Envoi de 20 requêtes GET /api/v1/ai/status $\rightarrow$ compteur ip:x.x.x.x:AI = 20.
* Tentative immédiate d'appel POST /api/v1/ai/chat/completions $\rightarrow$ Bloqué avec **HTTP 429** (code:  TOO_MANY_REQUESTS, 	ier: AI).
* Inversement, 20 complétions bloquaient également toute consultation de diagnostic GET /api/v1/ai/status.

---

## 3. ANALYSE DE CLASSIFICATION & POLITIQUE RETENUE

### 3.1 Détermination du Tier approprié
* **Rôle de l'endpoint** : Diagnostic en lecture seule, statut de santé du service IA.
* **Choix d'architecture** : Volaco Core dispose déjà de 3 tiers standardisés :
  - DEFAULT : 120 req/min (requêtes de lecture standard et navigation) ;
  - MUTATION : 60 req/min (opérations d'écriture HTTP POST/PUT/DELETE) ;
  - AI : 20 req/min (opérations LLM consommatrices de GPU et de crédits api.mistral.ai).
* **Alignement** : Créer un nouveau tier artificiel aurait alourdi la surface de configuration sans valeur ajoutée. Rapprocher GET /api/v1/ai/status du tier DEFAULT (120 req/min) garantit :
  1. Une séparation complète des clés de stockage (:DEFAULT vs :AI) ;
  2. Une bande passante confortable pour les sondes (jusqu'à 2 req/seconde) ;
  3. Une protection anti-DoS maintenue (le endpoint reste limité à 120 req/min et ne devient pas un endpoint infini).

---

## 4. ARCHITECTURE DU CORRECTIF

### 4.1 Modification dans pps/api/src/middleware/rate-limiter.ts

`	ypescript
public resolveTier(method: string = 'GET', pathname: string = '/'): RateLimitTier {
  const upperMethod = (method || 'GET').toUpperCase();
  if (this.isAiRoute(pathname)) {
    // P6-VULN-04: Les endpoints de statut / diagnostic IA en lecture (GET) ne doivent pas
    // entrer en collision de quota avec les complétions IA consommatrices de tokens LLM (tier AI).
    // Ils sont classés dans le tier DEFAULT (120 req/min).
    const cleanPath = (pathname.split('?')[0] ?? '').split('#')[0] ?? '';
    const normalized = cleanPath.toLowerCase().replace(/\/+/g, '/').replace(/\/$/, '') || '/';
    const isStatusRoute = normalized === '/api/v1/ai/status' || normalized === '/ai/status';

    if (isStatusRoute && upperMethod === 'GET') {
      return 'DEFAULT';
    }

    return 'AI';
  }
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(upperMethod)) {
    return 'MUTATION';
  }
  return 'DEFAULT';
}
`

### 4.2 Propriétés de sécurité garanties
1. **Séparation des buckets** :
   - GET /api/v1/ai/status incrémente la clé ip:<ip>:DEFAULT ou 	enant:<id>:DEFAULT.
   - POST /api/v1/ai/chat/completions incrémente la clé ip:<ip>:AI ou 	enant:<id>:AI.
2. **Indépendance mutuelle** :
   - La saturation de GET /api/v1/ai/status laisse intact le quota des 20 requêtes IA.
   - La saturation des 20 complétions IA ne bloque pas le monitoring.
3. **Ségrégation par méthode HTTP** :
   - Seule la méthode GET bénéficie du reclassement en DEFAULT.
   - Un appel mutatif inattendu (ex: POST /api/v1/ai/status) conserve le tier AI.
4. **Préservation stricte de P6-REMEDIATION-003** :
   - /api/v1/ai/chat/completions et /ai/chat/completions (avec trailing slashes, variations de casse, query-strings) restent unifiées sous le tier AI.

---

## 5. VALIDATION OFFENSIVE (RED-TEAM-P6-REMEDIATION-004)

Une suite dédiée de 16 tests a été exécutée (pps/api/tests/security/red-team-p6-remediation-004.test.ts) :

| Test ID | Libellé du Test | Résultat |
|:---|:---|:---:|
| **TEST 1** | GET /api/v1/ai/status résout en tier DEFAULT | **PASS** |
| **TEST 2** | POST /api/v1/ai/chat/completions résout en tier AI | **PASS** |
| **TEST 3** | Saturation status : épuiser le quota status ne bloque pas les complétions | **PASS** |
| **TEST 4** | Saturation completion : épuiser le quota AI ne bloque pas le diagnostic status | **PASS** |
| **TEST 5** | Preuve d'indépendance : STATUS_BUCKET !== AI_COMPLETION_BUCKET | **PASS** |
| **TEST 6** | Toutes les variantes de complétions restent strictement en tier AI | **PASS** |
| **TEST 7** | Toutes les variantes de status (/ai/status, trailing slash, query) sont en DEFAULT | **PASS** |
| **TEST 8** | Protection anti-spoofing : les routes leurres (status-fake, status/other) ne s'échappent pas | **PASS** |
| **TEST 9** | Ségrégation par méthode : POST /api/v1/ai/status conserve le tier AI | **PASS** |
| **TEST 10** | Preuve HTTP serveur réelle : validation des headers X-RateLimit-Limit en production | **PASS** |
| **TEST 11** | Polling concurrent : 20 requêtes status parallèles n'altèrent pas le quota IA | **PASS** |
| **TEST 12** | Magasin partagé : persistance multi-instance SharedFileRateLimitStore validée sur disque | **PASS** |
| **TEST 13** | Isolation Multi-Tenant : le polling du Tenant A n'affecte en rien les complétions du Tenant B | **PASS** |
| **TEST 14** | Non-régression P6-003 : /api/v1/ai/... et /ai/... partagent toujours le même bucket AI | **PASS** |
| **TEST 15** | Non-régression P6-001 & P6-002 : normalisation USER et dégradation sécuritaire de system | **PASS** |
| **FUZZING** | 30 permutations de chemins et de méthodes testées sans aucune déviation | **PASS** |

**Score de la suite dédiée** : **16/16 PASS (100%)**.

---

## 6. VALIDATION DE NON-RÉGRESSION GLOBALE

1. **Suites P6 (P6-001, P6-002, P6-003, P6-004, P6 Hunt)** :
   - ed-team-p6-remediation-001.test.ts : 12/12 PASS
   - ed-team-p6-remediation-002.test.ts : 14/14 PASS
   - ed-team-p6-remediation-003.test.ts : 15/15 PASS
   - ed-team-p6-remediation-004.test.ts : 16/16 PASS
   - ed-team-p6-hunt.test.ts : 12/12 PASS (mise à jour du test 4 validée)
   - **Sous-total P6** : **69/69 PASS (100%)**

2. **Suites P5, P4, P3** :
   - ed-team-p5-remediation-*.test.ts, ed-team-p4-*.test.ts, ed-team-p3-live.test.ts :
   - **Sous-total** : **138/138 PASS (100%)**

3. **Portes Qualité Système** :
   - **Quality Gate 1** : **31/31 PASS (100%)**
   - **Quality Gate 2** : **1482/1482 PASS (100%)**
   - **TypeScript Compilation** : **0 erreur (Strict mode)**

---

## 7. MATRICE DE STATUT DES VULNÉRABILITÉS P6

Conformément à la règle **ONE MISSION = ONE VULNERABILITY**, les autres vulnérabilités P6 restent différées :

| Vulnérabilité | Sévérité | Statut | Prochaine étape |
|:---|:---:|:---:|:---|
| **P6-VULN-01** — AI Proxy Message Sanitizer Case-Sensitivity Bypass | MEDIUM | **PROVEN FIXED** | Clôturé (P6-REMEDIATION-001) |
| **P6-VULN-02** — AI Proxy Direct System Role Pass-Through | HIGH | **PROVEN FIXED** | Clôturé (P6-REMEDIATION-002) |
| **P6-VULN-03** — AI Rate Limiter Tier Bypass via Route Inconsistency | MEDIUM | **PROVEN FIXED** | Clôturé (P6-REMEDIATION-003) |
| **P6-VULN-04** — AI Status Self-DoS / Quota Collision | MEDIUM | **PROVEN FIXED** | Clôturé ce jour (P6-REMEDIATION-004) |
| **P6-VULN-05** — Versioning Deceptive Rollback & Revision History Inconsistency | LOW | **DEFERRED** | Mission P6-REMEDIATION-005 |
| **P6-VULN-06** — Null/Undefined Payload Unhandled Rejection (500 Error Disclosure) | LOW | **DEFERRED** | Mission P6-REMEDIATION-006 |

---

## 8. FICHIERS DU PÉRIMÈTRE

* **Fichiers modifiés** :
  - pps/api/src/middleware/rate-limiter.ts (ajustement de esolveTier pour GET /ai/status et /api/v1/ai/status)
  - pps/api/tests/security/red-team-p6-hunt.test.ts (mise à jour de l'assertion Test 4 vers la remédiation)
* **Nouveaux fichiers de test** :
  - pps/api/tests/security/red-team-p6-remediation-004.test.ts
* **Fichiers volontairement non modifiés** (hors scope strict) :
  - pps/api/src/routes/projects.ts (P6-VULN-06 différé)
  - packages/core/src/versioning/revisions.ts (P6-VULN-05 différé)
  - pps/api/src/routes/ai.ts (inchangé, intégrité préservée)

---

## 9. NIVEAU DE CONFIANCE & VERDICT

* **Niveau de confiance** : **TRÈS ÉLEVÉ** (reproduction offensive avant/après, preuve HTTP réelle, validation sur magasin de fichiers partagé, isolation multi-tenant et 1482 tests de régression franchis).
* **Limitation** : Le endpoint de statut dispose d'un plafond de 120 requêtes/minute (tier DEFAULT). Ce débit est suffisant pour des sondes internes et empêche un déni de service non authentifié illimité.

`	ext
======================================================================
                  P6-REMEDIATION-004 VERDICT : FIXED
======================================================================
`
