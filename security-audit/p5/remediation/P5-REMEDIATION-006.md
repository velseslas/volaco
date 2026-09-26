# RAPPORT DE REMÉDIATION — P5-REMEDIATION-006

## 1. FINDING ORIGINAL
- **Finding ID :** P5-LOW-02
- **Titre :** HTTPS Enforcement Depends on `REQUIRE_HTTPS=true` (Insecure Plain HTTP Accepted by Default)
- **CWE :** CWE-319 (Cleartext Transmission of Sensitive Information)
- **Gravité Initiale :** LOW (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N - 5.3)
- **Statut :** **FIXED**
- **Date de Remédiation :** 2026-09-12
- **Surface d'Attaque :** Transport Layer Security & Reverse Proxy Forwarding (`server.ts`, `config.ts`)
- **Composants Cibles :** `apps/api/src/server.ts`, `packages/core/src/config.ts`
- **Suite de Tests Dédiée :** `apps/api/tests/security/red-team-p5-remediation-006.test.ts` (12 vecteurs d'attaque)

---

## 2. ROOT CAUSE & PROBLÉMATIQUE TECHNIQUE

Dans l'état antérieur de la base de code (`apps/api/src/server.ts`), la condition de vérification HTTPS était rédigée ainsi :

```typescript
// Code vulnérable antérieur
if (config.env === 'production' && !isHttps && !forwardedHttps && process.env.REQUIRE_HTTPS === 'true') {
  res.statusCode = 403;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    error: 'HTTPS is required in production',
    code: 'HTTPS_REQUIRED',
    requestId
  }));
  return;
}
```

### Vulnérabilité Identifiée :
1. **Défaut d'activation (Opt-in au lieu d'Opt-out/Default) :** La condition exigeait explicitement `process.env.REQUIRE_HTTPS === 'true'`. En cas d'omission de cette variable d'environnement lors d'un déploiement en production, l'API acceptait silencieusement toutes les requêtes en clair HTTP direct sans rejet ni redirection.
2. **Vulnérabilité au Man-in-the-Middle (MitM) :** Les tokens d'authentification JWT (`Authorization: Bearer <token>`), données de projet et clés API AI transitaient en clair sur le réseau sans garantie de chiffrement TLS.
3. **Absence de protection Fail-Closed :** Aucune barrière n'empêchait un opérateur de désactiver par mégarde HTTPS en production (`REQUIRE_HTTPS=false`).
4. **Risque d'usurpation d'en-tête (Header Spoofing) :** Si un client direct non approuvé envoyait `X-Forwarded-Proto: https`, le serveur risquait de valider la requête sans vérifier que l'émetteur était un proxy de confiance (`trustedProxies`).
5. **Absence de protection sur les Upgrades WebSocket :** Les requêtes HTTP avec `Upgrade: websocket` échappaient à la vérification HTTPS avant la négociation du protocole.

---

## 3. THREAT MODEL & SCÉNARIOS D'ATTAQUE

```text
SCÉNARIO 1 : DÉPLOIEMENT PRODUCTION PAR DÉFAUT SANS VARIABLE D'ENVIRONNEMENT
[Client / Navigateur] ----(HTTP en clair sans TLS)----> [API Volaco (Production)]
                                                         • REQUIRE_HTTPS non défini
                                                         • AVANT : 200 OK (Données et JWT en clair !)
                                                         • APRÈS : 403 Forbidden HTTPS_REQUIRED [BLOQUÉ]

SCÉNARIO 2 : SPOOFING D'EN-TÊTE VIA CLIENT NON DE CONFIANCE
[Attaquant (IP: 198.51.100.2)] 
   |
   +--- HTTP Direct + En-tête "X-Forwarded-Proto: https" ---> [API Volaco]
                                                                • IP émettrice ∉ trustedProxies
                                                                • AVANT : Risque de validation illégitime
                                                                • APRÈS : En-têtes ignorés -> 403 Forbidden [BLOQUÉ]

SCÉNARIO 3 : EN-TÊTES CONTRADICTOIRES / POLLUTION
[Attaquant] ---- HTTP Direct + "X-Forwarded-Proto: https,http" ----> [API Volaco]
                                                                     • Valeur ambiguë / polluée
                                                                     • APRÈS : Fail-closed immédiat -> 403 Forbidden [BLOQUÉ]
```

---

## 4. ARCHITECTURE DE REMÉDIATION

La remédiation a été structurée en deux niveaux complémentaires :

### Niveau 1 : Définition Déterministe dans la Configuration (`packages/core/src/config.ts`)

La structure `AppConfig` intègre formellement le paramètre `requireHttps` :
- En environnement de production (`env === 'production'` ou `NODE_ENV === 'production'`), `requireHttps` est **strictement activé (`true`) par défaut**.
- **Fail-Closed strict :** Même si un opérateur tente de définir explicitement `REQUIRE_HTTPS=false`, la configuration de production refuse d'abaisser le niveau de sécurité et force `requireHttps = true`.
- En environnement de développement (`development`) ou de test, `requireHttps` vaut `false` par défaut afin de préserver les flux locaux sur `localhost`.

```typescript
// packages/core/src/config.ts
const isProd = resolvedEnv === 'production';
let requireHttps: boolean;
if (isProd) {
  // Production enforces HTTPS by default; fail-closed: cannot be disabled
  requireHttps = true;
} else {
  requireHttps = process.env.REQUIRE_HTTPS === 'true';
}
```

### Niveau 2 : Enforcement Rigoureux dans le Serveur HTTP (`apps/api/src/server.ts`)

Dans le pipeline de traitement des requêtes HTTP :

1. **Calcul de TLS Direct et Forwarded Sécurisé :**
   - Détection directe : `(req.socket as any).encrypted === true`.
   - Détection via Reverse Proxy de confiance :
     - Vérification que l'adresse IP distante (`remoteIp`) figure dans la liste `trustedProxies` (`127.0.0.1`, `::1`, ou adresses configurées).
     - Si l'IP n'est pas de confiance, les en-têtes `X-Forwarded-*` et `Forwarded` sont **strictement ignorés**.
2. **Support des Standards RFC 7239 & X-Forwarded-Proto :**
   - En-tête standard RFC 7239 : `Forwarded: proto=https` avec vérification de frontières de mots (`/\bproto=https\b/i` et absence de `/\bproto=http\b/i`).
   - En-tête `X-Forwarded-Proto` : validation stricte que la chaîne commence par `https` et ne contient pas de valeur contradictoire (`http`).
3. **Exceptions Contrôlées pour Sondes d'Infrastructure :**
   - Les routes de diagnostic interne (`/health`, `/api/v1/health`, `/status`, `/api/v1/status`) restent accessibles en HTTP interne par les orchestrateurs (Kubernetes Liveness/Readiness probes, Docker healthchecks).
   - Toutes les routes métier (`/api/v1/projects`, `/api/v1/ai/*`, `/api/v1/agents/*`, `/`, `/shell`, etc.) appliquent le blocage HTTPS obligatoire sans exception.
4. **Interception des Événements `upgrade` (WebSocket) :**
   - Le serveur enregistre un écouteur `server.on('upgrade', ...)` qui valide l'état HTTPS avant toute transition de protocole. Les tentatives WebSocket en clair HTTP direct sont rejetées avec HTTP 403.

---

## 5. INVARIANTS DE SÉCURITÉ PRÉSERVÉS (P5-001 À P5-005)

| Invariant | Statut | Vérification |
| :--- | :--- | :--- |
| **P5-001 (Vérification Cryptographique JWT)** | **PRÉSERVÉ** | Les requêtes HTTPS continuent d'exécuter la validation cryptographique HMAC-SHA256 stricte de l'en-tête `Authorization`. |
| **P5-002 (Absence de Fuite d'Erreurs 500)** | **PRÉSERVÉ** | Les réponses d'erreur (y compris 403 `HTTPS_REQUIRED`) retournent un corps standardisé sans trace d'exécution ni détail interne. |
| **P5-003 (RBAC AI Proxy)** | **PRÉSERVÉ** | Le contrôle d'accès par rôle et par tenant sur `/api/v1/ai/*` demeure intact et opère derrière le rempart HTTPS. |
| **P5-004 (SRI & Politiques CSP)** | **PRÉSERVÉ** | Les en-têtes de sécurité Content-Security-Policy (CSP) et les attributs SRI sur Volaco Studio sont appliqués immédiatement après le contrôle HTTPS. |
| **P5-005 (Rate Limiter Multi-Instance)** | **PRÉSERVÉ** | Le composant `RateLimiter` partagé inter-processus (`SharedFileRateLimitStore`) est exécuté immédiatement après validation HTTPS. |

---

## 6. RÉSULTATS DE LA SUITE DE TESTS OFFENSIVE (12 VECTEURS)

La suite `apps/api/tests/security/red-team-p5-remediation-006.test.ts` a validé 100% des scénarios d'attaque :

| # | Scénario d'Attaque / Vecteur | Comportement Attendu | Résultat | Statut |
|---|------------------------------|----------------------|----------|--------|
| **1** | Production - Requête HTTP directe | HTTP 403 `HTTPS_REQUIRED` | HTTP 403 retourné | **VERIFIED** |
| **2** | Production - Requête avec TLS / Proxy de confiance | HTTP 200 OK | HTTP 200 retourné | **VERIFIED** |
| **3** | Production - `REQUIRE_HTTPS` absent de l'environnement | HTTP 403 `HTTPS_REQUIRED` | HTTP 403 retourné | **VERIFIED** |
| **4** | Production - Tentative de contournement via `REQUIRE_HTTPS=false` | Fail-closed : HTTP 403 | HTTP 403 retourné | **VERIFIED** |
| **5** | Développement - Requête HTTP directe localhost | HTTP 200 OK (tolérance dev) | HTTP 200 retourné | **VERIFIED** |
| **6** | Production - IP non de confiance spoofant `X-Forwarded-Proto: https` | Spoofing ignoré : HTTP 403 | HTTP 403 retourné | **VERIFIED** |
| **7** | Production - Reverse Proxy de confiance avec `X-Forwarded-Proto: https` | HTTP 200 OK | HTTP 200 retourné | **VERIFIED** |
| **8** | Matrice de conformité des en-têtes RFC 7239 `Forwarded` | `proto=https` accepté, `proto=http` rejeté | Conforme RFC 7239 | **VERIFIED** |
| **9** | Production - En-têtes contradictoires / mixtes (`https,http`) | Fail-closed : HTTP 403 | HTTP 403 retourné | **VERIFIED** |
| **10** | Production - Tentative d'upgrade WebSocket en HTTP direct | Rejet HTTP 403 | Socket rejeté 403 | **VERIFIED** |
| **11** | Délimitation des sondes (`/health` vs routes métier `/api/v1/projects`) | `/health` = 200, route métier = 403 | Délimitation stricte | **VERIFIED** |
| **12** | Matrice de résolution de configuration | Déterminisme strict | Conforme | **VERIFIED** |

**Score Red Team : 12/12 PASS (100%)**

---

## 7. RÉSULTATS DE NON-RÉGRESSION GLOBALE

1. **Suites P5 Complètes (`red-team-p5-remediation-*.test.ts`) :**
   - `red-team-p5-remediation-001.test.ts` : 10/10 PASS
   - `red-team-p5-remediation-002.test.ts` : 12/12 PASS
   - `red-team-p5-remediation-003.test.ts` : 12/12 PASS
   - `red-team-p5-remediation-004.test.ts` : 13/13 PASS
   - `red-team-p5-remediation-005.test.ts` : 12/12 PASS
   - `red-team-p5-remediation-006.test.ts` : 12/12 PASS
   - `rate-limit.test.ts` : 8/8 PASS
   - **Total P5 : 79/79 PASS**

2. **Suites Historiques :**
   - Gate 1 (`run_gate1_tests.mjs`) : 31/31 PASS
   - Red Team P3 Production (`red-team-p3-production.test.ts`) : 51/51 PASS
   - Red Team P4 Independent (`red-team-p4-independent.test.ts`) : 23/23 PASS

3. **Gate 2 :** 1413/1413 PASS, 0 fail (100% des tests validés).

---

## 8. CONCLUSION & VERDICT D'AUDIT

La vulnérabilité **P5-LOW-02** est intégralement résolue.
L'API Volaco adopte désormais une posture de sécurité **Secure by Default** et **Fail-Closed** :
- Le protocole HTTPS est obligatoire par défaut en production.
- Aucune configuration erronée ou omission de variable d'environnement ne peut compromettre le chiffrement des flux en production.
- Les proxies inverses légitimes sont supportés via les standards de l'industrie (RFC 7239 et `X-Forwarded-Proto`) avec protection anti-usurpation.
- Tous les invariants de sécurité issus des remédiations antérieures (P5-001 à P5-005) sont rigoureusement maintenus.

**VERDICT FINAL : FIXED**
