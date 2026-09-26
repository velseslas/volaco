# RAPPORT DE REMÉDIATION — P6-REMEDIATION-003

## VULNÉRABILITÉ : P6-VULN-03 — AI Rate Limiting Tier Bypass via Route Inconsistency

* **Projet** : Volaco Core
* **Mission** : P6-REMEDIATION-003
* **Date** : 12 Septembre 2026
* **Sévérité** : MEDIUM (CVSS v3.1: 6.5 / CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:H)
* **Auteur / Évaluateur** : Équipe Sécurité Offensive & Red Team Volaco
* **Statut Final** : **FIXED**

---

## 1. RÉSUMÉ EXÉCUTIF

Lors de la mission **P6 Independent Final Red Team / Zero-Day Hunt**, une vulnérabilité de classification de route dans le middleware de limitation de débit (RateLimiter) a été mise en évidence :

* **Comportement nominal** : Les routes sous /api/v1/ai/... étaient classées dans le tier AI (AI_TIER_LIMIT = 20 req/min).
* **Faille constatée** : L'endpoint alternatif non versionné POST /ai/chat/completions n'était pas reconnu par la condition pathname.startsWith('/api/v1/ai').
* **Conséquence directe** : POST /ai/chat/completions basculait par défaut dans le tier MUTATION (60 req/min) sur une clé de compteur disjointe. Un attaquant pouvait cumuler les deux endpoints pour atteindre un quota total de **80 req/min** (soit une inflation de quota de 400% et un contournement direct de la politique de coûts et de consommation du fournisseur LLM).

Dans le cadre strict de **P6-REMEDIATION-003**, la vulnérabilité a été corrigée à la racine par une normalisation unifiée des routes AI, assurant que tout appel aux endpoints de complétion IA (canoniques ou alternatifs, avec variations de casse, query-string ou barres obliques) soit systématiquement rattaché au tier AI et partage la même clé de comptage.

---

## 2. ANALYSE TECHNIQUE ET CAUSE RACINE

### 2.1 Code vulnérable avant correction

Dans pps/api/src/middleware/rate-limiter.ts :

`	ypescript
// AVANT (Vulnérable)
public resolveTier(method: string, pathname: string): RateLimitTier {
  if (pathname.startsWith('/api/v1/ai')) {
    return 'AI';
  }
  if (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH') {
    return 'MUTATION';
  }
  return 'DEFAULT';
}
`

### 2.2 Vecteur d'attaque démontré (PoC)

1. Envoi de 20 requêtes sur POST /api/v1/ai/chat/completions : le quota AI (20 req/min) est atteint.
2. Bascule immédiate sur POST /ai/chat/completions :
   - pathname.startsWith('/api/v1/ai') renvoie alse.
   - method === 'POST' renvoie 	rue.
   - La requête est classée en MUTATION (quota de 60 requêtes/min).
   - Le middleware alloue une clé séparée 	enant:tenant-id:MUTATION ou ip:x.x.x.x:MUTATION.
3. L'attaquant dispose de 60 requêtes supplémentaires, court-circuitant le tiering économique et risquant de provoquer un épuisement de quota LLM amont ou un déni de service financier.

---

## 3. ARCHITECTURE DE LA CORRECTION

### 3.1 Normalisation robuste des routes IA (isAiRoute)

Une méthode dédiée et unifiée isAiRoute a été implémentée dans RateLimiter (pps/api/src/middleware/rate-limiter.ts) :

1. **Suppression des query strings et ancres** : isolation stricte du chemin via découpage sur ? et #.
2. **Normalisation de la casse** : conversion en minuscules (	oLowerCase()) pour parer aux variations de casse (ex. /API/V1/AI/..., /Ai/...).
3. **Suppression des slashes redondants et finaux** : remplacement des barres obliques consécutives multiples par un slash unique (eplace(/\/+/g, '/')) et élimination des slashes de fin.
4. **Correspondance stricte aux frontières de chemin** :
   - Pour /api/v1/ai : vérification stricte cleanPath === '/api/v1/ai' || cleanPath.startsWith('/api/v1/ai/').
   - Pour /ai : vérification stricte cleanPath === '/ai' || cleanPath.startsWith('/ai/').
   - Empêche tout faux positif sur des chemins leurres comme /ai-fake, /ai_service, ou /api/v1/ai-status-unrelated.

### 3.2 Implémentation du correctif

`	ypescript
public isAiRoute(pathname: string): boolean {
  if (!pathname) return false;
  // 1. Extraire le chemin pur sans query ni hash
  const rawPath = pathname.split('?')[0]?.split('#')[0] || '';
  // 2. Normaliser les slashes multiples et minuscules
  const cleanPath = rawPath.replace(/\/+/g, '/').replace(/\/+$/, '').toLowerCase();
  
  // 3. Détection stricte sur les frontières canoniques d'API
  if (cleanPath === '/api/v1/ai' || cleanPath.startsWith('/api/v1/ai/')) {
    return true;
  }
  if (cleanPath === '/ai' || cleanPath.startsWith('/ai/')) {
    return true;
  }
  return false;
}

public resolveTier(method: string, pathname: string): RateLimitTier {
  if (this.isAiRoute(pathname)) {
    return 'AI';
  }
  if (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH') {
    return 'MUTATION';
  }
  return 'DEFAULT';
}
`

### 3.3 Effets de sécurité garantis

* Les deux endpoints POST /api/v1/ai/chat/completions et POST /ai/chat/completions sont identifiés sous le tier AI.
* La génération de la clé de rate limiting utilisant getKey(req, 'AI') produit un identifiant commun (ex: 	enant:tenant-id:AI ou ip:x.x.x.x:AI), assurant la mutualisation absolue du compteur.
* L'épuisement du quota sur l'une des routes bloque instantanément l'autre avec HTTP 429 (	ier:  AI).

---

## 4. SUITE DE TESTS OFFENSIFS (RED-TEAM-P6-REMEDIATION-003)

Une suite offensive dédiée de 15 tests unitaires, d'intégration HTTP et de fuzzing a été développée et validée dans pps/api/tests/security/red-team-p6-remediation-003.test.ts :

| ID | Intitulé du Test | Résultat |
|:---|:---|:---:|
| **TEST 1** | Endpoint canonique /api/v1/ai/chat/completions résolu en tier AI | **PASS** |
| **TEST 2** | Endpoint alternatif /ai/chat/completions résolu en tier AI (Correctif P6-VULN-03) | **PASS** |
| **TEST 3** | Trailing slashes (/api/v1/ai/chat/completions/, ///ai/chat/completions///) résolus en AI | **PASS** |
| **TEST 4** | Query strings complexes (?x=1&y=2#frag, ?model=codestral) résolus en AI | **PASS** |
| **TEST 5** | Protection contre le spoofing de préfixe : /api/v1/ai-malicious, /ai-fake non classés en AI | **PASS** |
| **TEST 6** | Normalisation des chemins avec barres obliques redondantes et cas limites | **PASS** |
| **TEST 7** | Mutualisation stricte du bucket de quota : 20 requêtes cumulées partagées entre routes | **PASS** |
| **TEST 8** | Étanchéité des routes métier hors IA (/api/v1/projects, /api/v1/audit) en MUTATION/DEFAULT | **PASS** |
| **TEST 9** | Immunité contre l'injection de paramètres trompeurs (?ai=1, ?path=/ai) sur routes non-IA | **PASS** |
| **TEST 10** | Préservation des tiers avec barres obliques finales sur routes non-IA | **PASS** |
| **TEST 11** | Insensibilité à la casse (/API/V1/AI/..., /Ai/Chat/...) résolue en AI | **PASS** |
| **TEST 12** | **Preuve HTTP bout-en-bout** : Épuisement réel sur serveur HTTP et déclenchement du 429 | **PASS** |
| **TEST 13** | Non-régression P6-001 & P6-002 : assainissement des rôles et dégradation de system | **PASS** |
| **TEST 14** | Non-régression P5 : extraction du tenant JWT et rejet des faux jetons | **PASS** |
| **TEST 15** | Fuzzing ciblé : 25 permutations de chemins et de caractères spéciaux | **PASS** |

**Bilan de la suite P6-REMEDIATION-003** : **15/15 PASS (100%)**.

---

## 5. RÉSULTATS DE NON-RÉGRESSION GLOBALE

Toutes les suites de tests de sécurité et les portes qualité du projet ont été ré-exécutées :

1. **P6 Remediation Suites & Hunt** :
   - ed-team-p6-remediation-001.test.ts : 12/12 PASS
   - ed-team-p6-remediation-002.test.ts : 14/14 PASS
   - ed-team-p6-remediation-003.test.ts : 15/15 PASS
   - ed-team-p6-hunt.test.ts : 12/12 PASS (mise à jour de l'assertion Test 3 validée)
   - **Total P6** : **53/53 PASS**

2. **P5 Suites (P5-001 à P5-006)** :
   - Rate Limiter Multi-Instance, JWT Auth, HTTPS Enforcement, Error Disclosure, AI Proxy RBAC, CDN/SRI :
   - **Total P5 / P4 / P3** : **138/138 PASS**

3. **Quality Gate 1** :
   - FND-001 à FND-005 : **31/31 PASS**

4. **Quality Gate 2** :
   - Suites globales (1466 tests) + Contrôles CAPP + Validation Studio : **1466/1466 PASS (100%)**

5. **Contrôle TypeScript** :
   - 	sc --noEmit : **0 erreur**.

---

## 6. STATUT DES VULNÉRABILITÉS RESTANTES (DEFERRED)

Conformément à la règle impérative **ONE MISSION = ONE VULNERABILITY**, les autres vulnérabilités découvertes lors de la campagne P6 demeurent différées pour leurs missions respectives :

| Vulnérabilité | Sévérité | Statut | Prochaine étape |
|:---|:---:|:---:|:---|
| **P6-VULN-01** — AI Proxy Message Sanitizer Case-Sensitivity Bypass | MEDIUM | **FIXED** | Validé (P6-REMEDIATION-001) |
| **P6-VULN-02** — AI Proxy Direct System Role Pass-Through | HIGH | **FIXED** | Validé (P6-REMEDIATION-002) |
| **P6-VULN-03** — AI Rate Limiter Tier Bypass via Route Inconsistency | MEDIUM | **FIXED** | Validé ce jour (P6-REMEDIATION-003) |
| **P6-VULN-04** — AI Status Self-DoS via Recursive/Looping Endpoints | MEDIUM | **DEFERRED** | Mission P6-REMEDIATION-004 |
| **P6-VULN-05** — Versioning Deceptive Rollback & Revision History Inconsistency | LOW | **DEFERRED** | Mission P6-REMEDIATION-005 |
| **P6-VULN-06** — Null/Undefined Payload Unhandled Rejection (500 Error Disclosure) | LOW | **DEFERRED** | Mission P6-REMEDIATION-006 |

---

## 7. VERDICT

`	ext
======================================================================
                  P6-REMEDIATION-003 VERDICT : FIXED
======================================================================
`
* La classification de route pour tous les chemins de complétion IA pointe de manière déterministe vers le tier AI.
* Les quotas de requêtes sont partagés au sein d'un même compteur unifié.
* Aucune route non-IA n'est compromise ou sur-restreinte.
* 100% des tests de régression (P6, P5, P4, P3, Gate 1, Gate 2) sont validés avec succès.
