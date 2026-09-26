# P8-FINAL — INDEPENDENT SECURITY REVALIDATION & SECURITY CLOSURE REPORT

**Plateforme :** Volaco Core Monorepo (Node.js / TypeScript / REST API / VibeCode Studio)  
**Date d'évaluation :** 14 Septembre 2026  
**Type d'évaluation :** Revalidation Indépendante Ciblée P8 & Décision de Clôture (Règle stricte : Zéro modification de code source)  
**Auditeur :** Antigravity Security Red Team  
**Statut Global / Décision :** **SECURITY BASELINE NOT FROZEN**  

---

## 1. Executive Summary

Dans le cadre du cycle **P8-FINAL — Independent Security Revalidation & Security Closure**, une campagne de revalidation indépendante et contradictoire a été menée pour évaluer l'efficacité réelle des remédiations P8 sur le monorepo Volaco Core.

L'objectif de cette mission est de déterminer formellement si le système peut figer sa ligne de base de sécurité (**SECURITY BASELINE FROZEN**) ou si des faiblesses résiduelles imposent le maintien du statut **SECURITY BASELINE NOT FROZEN**.

### Résultats Synthétiques :
1. **Intégrité de la Baseline :** 100% PASS sur l'ensemble des suites nominales et historiques (TypeScript strict, Build production, Gate 1 à 31/31, Gate 2 à 1672/1672, P6 à 103/103, P7 à 156/156, P8 suite à 37/37).
2. **P8-VULN-01 (CRLF / Env Injection) :** **FIXED**. La regex stricte `/^[A-Za-z0-9_\-\.]{15,128}$/` bloque 100% des tentatives d'injection de retours chariots, octets nuls, caractères de contrôle ou commandes.
3. **P8-VULN-02 (Global AI Key & Tenant Isolation) :** **FIXED** (avec 1 observation de type HARDENING / INFORMATIONAL sur le shadowing de la route de statut public). L'isolation en mémoire `tenantAiKeys` prévient tout détournement ou écrasement de la clé globale par un locataire non privilégié.
4. **P8-VULN-03 (Multi-Tenant Project Isolation sur `default-project`) :** **FIXED**. L'indexation composite `${tenantId}:${id}` dans les dépôts mémoire et durables garantit une séparation hermétique entre locataires sur les identifiants partagés.
5. **P8-VULN-04 (SSRF & URL Validation) :** **NOT FIXED (PARTIALLY MITIGATED)**. Bien que les domaines génériques de rebinding et les IPv4 privées soient bloqués, la validation syntaxique présente deux faiblesses architecturales majeures :
   - Désynchronisation syntaxique IPv6 : `new URL` normalise `http://[::1]/` avec crochets `[::1]`, tandis que la liste noire vérifie `::1` (sans crochets). L'adresse de boucle locale IPv6 contourne donc le filtre.
   - Absence de résolution DNS / Pinning d'adresse IP : Tout nom de domaine enregistré par un attaquant résolvant sur `127.0.0.1` ou `169.254.169.254` franchit la validation syntaxique.
6. **Verdict Formel :** Conformément au Critère 9 de l'énoncé (*"Si le SSRF reste insuffisamment protégé, NE PAS déclarer FROZEN"*), le verdict est officiellement :
   ### **SECURITY BASELINE NOT FROZEN**

---

## 2. Baseline

Avant toute épreuve d'attaque, les suites nominales et historiques ont été exécutées et validées sans aucune modification :

| Contrôle | Commande | Résultat | Détails |
| :--- | :--- | :--- | :--- |
| **TypeScript Strict** | `node ./node_modules/typescript/bin/tsc --noEmit` | **PASS** | 0 erreur de typage |
| **Compilation Production** | `node ./node_modules/typescript/bin/tsc` | **PASS** | Build complet `dist/` sans erreur |
| **Quality Gate 1** | `node ./scripts/run_gate1_tests.mjs` | **PASS** | 31/31 tests réussis (100%) |
| **Quality Gate 2** | `node ./scripts/run_gate2_tests.mjs` | **PASS** | 1672/1672 tests réussis (100%) |
| **P6 Security Suite** | `node --test dist/apps/api/tests/security/red-team-p6-*.test.js` | **PASS** | 103/103 tests réussis (100%) |
| **P7 Adversarial Suite** | `node --test dist/apps/api/tests/security/p7-*.test.js` | **PASS** | 156/156 tests réussis (100%) |
| **P8 Probe Suite** | `node scratch/test_p8_suite.cjs` | **PASS** | 37/37 tests réussis (100%) |

---

## 3. Revalidation P8-VULN-01 — CRLF / Env Injection

**Cible :** `POST /api/v1/ai/configure-key`  
**Statut :** **FIXED**

### Matrice des Vecteurs d'Attaque Testés :

| Vecteur / Payload | Description | Résultat Observé | Statut |
| :--- | :--- | :--- | :--- |
| `valid_key\rINJECTED=1` | Retour chariot isolé (`\r`) | HTTP 400 ValidationError | **PASS** |
| `valid_key\nINJECTED=1` | Saut de ligne isolé (`\n`) | HTTP 400 ValidationError | **PASS** |
| `valid_key\r\nINJECTED=1`| Combinaison CRLF (`\r\n`) | HTTP 400 ValidationError | **PASS** |
| `valid_key\0INJECTED=1` | Octet nul (`\0`) | HTTP 400 ValidationError | **PASS** |
| `valid_key\x07INJECTED=1`| Caractère de contrôle (Bell) | HTTP 400 ValidationError | **PASS** |
| `valid key 1234567890` | Espaces internes | HTTP 400 ValidationError | **PASS** |
| `valid_key\tINJECTED=1` | Tabulation (`\t`) | HTTP 400 ValidationError | **PASS** |
| `valid_key_12345_секрет` | Caractères Unicode / Cyrillique | HTTP 400 ValidationError | **PASS** |
| `valid_key_12345_🔥` | Emojis | HTTP 400 ValidationError | **PASS** |
| `'A'.repeat(129)` | Clé trop longue (> 128 caractères) | HTTP 400 ValidationError | **PASS** |
| `short_key_123` | Clé trop courte (< 15 caractères) | HTTP 400 ValidationError | **PASS** |
| `""` | Clé vide | HTTP 400 ValidationError | **PASS** |
| `"               "` | Espaces uniquement | HTTP 400 ValidationError | **PASS** |
| `valid_key\n# comment` | Commentaire shell multi-lignes | HTTP 400 ValidationError | **PASS** |
| `valid_key_$(whoami)` | Substitution de commande shell | HTTP 400 ValidationError | **PASS** |
| `valid_key" && MAL=1` | Guillemets doubles | HTTP 400 ValidationError | **PASS** |
| `valid_key' && MAL=1` | Guillemets simples | HTTP 400 ValidationError | **PASS** |
| `valid_key;INJECTED=1` | Point-virgule de chaînage | HTTP 400 ValidationError | **PASS** |
| `valid-key_12345.TEST` | Format conforme RFC (15-128 alphanum) | HTTP 200 OK | **PASS** |

### Démonstration d'Étanchéité :
L'assainissement s'appuie désormais sur `/^[A-Za-z0-9_\-\.]{15,128}$/`. Aucun caractère de saut de ligne ou délimiteur d'environnement ne peut atteindre la routine d'écriture dans le fichier `.env`. Le vecteur d'injection d'environnement sur l'hôte est neutralisé.

---

## 4. Revalidation P8-VULN-02 — Global AI Key & Tenant Isolation

**Cible :** Gestion de clé IA multi-locataires (`configure-key`, `status`, `chat/completions`)  
**Statut :** **FIXED** (avec 1 observation HARDENING / INFORMATIONAL)

### Scénarios Exécutés :
1. **Tenant A configure sa clé (`key_tenant_a`) :** Succès HTTP 200. La clé est enregistrée dans `tenantAiKeys` sous `tenant-a`.
2. **Tenant B configure sa clé (`key_tenant_b`) :** Succès HTTP 200. La clé est enregistrée dans `tenantAiKeys` sous `tenant-b`.
3. **Absence de mutation globale :** La variable système `process.env.MISTRAL_API_KEY` est restée strictement inchangée suite aux appels de Tenant A et Tenant B.
4. **Gouvernance Globale Platform Admin :** Seul un administrateur appartenant au locataire système (`default-tenant`) ou disposant d'un rôle `ADMIN`/`OWNER` de niveau plateforme peut modifier `process.env.MISTRAL_API_KEY` et mettre à jour `.env`.
5. **Rôle VIEWER :** Tentative de configuration par un `VIEWER` rejetée avec HTTP 403 Forbidden (`ForbiddenError`).
6. **Token Spoofé / Invalide :** Requête rejetée avec HTTP 401 Unauthorized.
7. **Sélection de clé au runtime dans `chat/completions` :** Dans `apps/api/src/routes/ai.ts` (lignes 188-195), la clé spécifique du locataire appelant `tenantAiKeys.get(context.tenantId)` est résolue et transmise en priorité au client LLM.

### Observation Complémentaire (HARDENING / INFORMATIONAL) :
- Dans `apps/api/src/server.ts` (ligne 268), la route `GET /api/v1/ai/status` est interceptée en amont comme endpoint public unifié, renvoyant l'état basé sur `process.env.MISTRAL_API_KEY`. Par conséquent, un locataire disposant d'une clé isolée mais en l'absence de clé globale serveur reçoit `available: false` sur cet appel de découverte préliminaire. Lors de l'envoi d'une complétion réelle (`POST /api/v1/ai/chat/completions`), sa clé spécifique est en revanche parfaitement honorée.

---

## 5. Revalidation P8-VULN-03 — Multi-Tenant Project Isolation

**Cible :** `ProjectStore`, `InMemoryProjectRepository`, `DurableProjectRepository`, et arborescences fichiers associées  
**Statut :** **FIXED**

### Scénarios Exécutés sur `default-project` :
1. **Création / Consultation simultanée :**
   - Tenant A consulte `GET /api/v1/projects/default-project` -> Projet `default-project` créé et rattaché à `tenant-a`.
   - Tenant B consulte `GET /api/v1/projects/default-project` -> Projet `default-project` créé et rattaché à `tenant-b`.
   - Tenant A ré-interroge `GET /api/v1/projects/default-project` -> Reçoit intact son projet appartenant à `tenant-a`.
2. **Isolation des Fichiers du Projet :**
   - Tenant A crée `secret-a.txt` (contenu : `SECRET_DATA_A`) dans son `default-project`.
   - Tenant B crée `secret-b.txt` (contenu : `SECRET_DATA_B`) dans son `default-project`.
   - Tenant B tente de lire `secret-a.txt` -> Rejet HTTP 404 Not Found.
   - Tenant A tente de lire `secret-b.txt` -> Rejet HTTP 404 Not Found.
   - Tenant B tente de supprimer `secret-a.txt` -> Rejet HTTP 404 Not Found.
   - Tenant A relit `secret-a.txt` -> Reçoit HTTP 200 avec contenu intègre `SECRET_DATA_A`.
3. **Validation Unitaire des Repositories :**
   - Les instances `InMemoryProjectRepository` et `DurableProjectRepository` utilisent la clé composite `${tenantId}:${id}`.
   - Deux entités de même ID sous deux locataires distincts coexistent dans la même table/map sans collision.
   - La suppression d'un ID sous le locataire 1 ne détruit pas l'entité sous le locataire 2.

---

## 6. Revalidation P8-VULN-04 — SSRF & Évaluation Architecturale

**Cible :** `validateSafeProviderUrl` dans `packages/core/src/ai/providers/types.ts`  
**Statut :** **NOT FIXED (PARTIALLY MITIGATED — HARDENING REQUIRED)**

L'audit approfondi de la validation d'URL révèle une dissociation entre le filtrage syntaxique et la protection réseau effective :

### Ce qui est correctement atténué (Syntactic Filter) :
- `http://127.0.0.1/v1` -> Rejeté (HTTP 400).
- `http://127.0.0.2:8080/v1` -> Rejeté (HTTP 400).
- `http://127.255.255.255/v1` -> Rejeté (HTTP 400).
- `http://localhost/v1`, `http://LOCALHOST/v1` -> Rejeté (HTTP 400).
- `http://0.0.0.0/v1` -> Rejeté (HTTP 400).
- `http://10.0.0.1/v1`, `http://172.16.0.1/v1`, `http://192.168.1.1/v1` -> Rejetés (HTTP 400).
- `http://169.254.169.254/latest/meta-data/` -> Rejeté (HTTP 400).
- Encodages IPv4 exotiques (Dword `2130706433`, Octal `0177.0.0.1`, Hex `0x7f000001`, 2-part `127.1`) -> Normalisés en `127.0.0.1` par le parseur WHATWG URL de Node.js et bloqués.
- Domaines de rebinding explicites (`localtest.me`, `nip.io`, `sslip.io`, `vcap.me`, `lvh.me`) -> Rejetés.

### Faiblesses et Vulnérabilités Résiduelles Confirmées :

1. **Contournement Boucle Locale IPv6 (`[::1]`) :**
   - *Cause racine :* `new URL('http://[::1]/v1').hostname` retourne `"[::1]"` (avec crochets selon la norme RFC 3986 / WHATWG).
   - *Code actuel :* `BLOCKED_HOSTS` contient `'::1'` (sans crochets).
   - *Résultat vérifié :* `BLOCKED_HOSTS.has("[::1]")` évalue à `false`. La regex IPv4 ne correspond pas. L'URL `http://[::1]/v1` est acceptée sans lever d'erreur.
   - *Preuve d'exécution :*
     ```
     validateSafeProviderUrl('http://[::1]/v1', ...) -> PASS (NON BLOQUÉ)
     ```

2. **Limite Architecturale : Rebinding DNS et Noms d'Hôtes Personnalisés :**
   - *Cause racine :* `validateSafeProviderUrl` opère **exclusivement au niveau syntaxique (hors ligne)** sur la chaîne du nom d'hôte.
   - *Scénario d'exploitation :* Si un locataire renseigne un `baseUrl` avec son propre domaine (ex. `api.attacker-domain.com`) dont l'enregistrement DNS `A` pointe sur `127.0.0.1`, `10.0.0.1` ou `169.254.169.254` :
     1. Le nom d'hôte `api.attacker-domain.com` n'est pas dans `BLOCKED_HOSTS`.
     2. Il ne correspond à aucune regex IP statique.
     3. La validation syntaxique réussit (PASS).
     4. Lors de l'appel HTTP par le client réseau, la résolution DNS système renvoie l'IP privée et la requête sortante atteint le service interne cible.
   - *Conclusion SSRF :* Une protection anti-SSRF robuste ne peut pas reposer uniquement sur une liste noire de noms de domaine. Elle requiert une résolution DNS asynchrone avant connexion et un filtrage au niveau de la couche transport (socket connection / pinning IP).

---

## 7. RBAC & Prototype Pollution

**Cible :** `hasPermission` dans `packages/core/src/identity/permissions.ts`  
**Statut :** **FIXED**

### Épreuves Contradictoires Réalisées :
L'interrogation de propriétés héritées du prototype JavaScript (`Object.prototype`) sur `ROLE_PERMISSIONS` a été testée :
- `hasPermission('toString' as any, 'PROJECT_READ')` -> `false` (aucun `TypeError`, aucun crash).
- `hasPermission('constructor' as any, 'PROJECT_READ')` -> `false`.
- `hasPermission('prototype' as any, 'PROJECT_READ')` -> `false`.
- `hasPermission('__proto__' as any, 'PROJECT_READ')` -> `false`.
- `hasPermission('valueOf' as any, 'PROJECT_READ')` -> `false`.
- `hasPermission('hasOwnProperty' as any, 'PROJECT_READ')` -> `false`.
- `hasPermission(null as any, 'PROJECT_READ')` -> `false`.
- `hasPermission(undefined as any, 'PROJECT_READ')` -> `false`.
- `hasPermission(12345 as any, 'PROJECT_READ')` -> `false`.
- `hasPermission({} as any, 'PROJECT_READ')` -> `false`.

L'intégration de `Object.hasOwn(ROLE_PERMISSIONS, role)` garantit une imperméabilité totale aux propriétés du prototype.

---

## 8. Résultats de Régression Historique

Toutes les suites de sécurité créées au fil des phases précédentes ont été relancées sans altération :

| Suite | Tests | Réussite | Échec | Statut |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 6 Red Team (P6-001 à P6-006)** | 103 | 103 | 0 | **100% PASS** |
| **Phase 7 Adversarial Fuzzing (P7-001 à P7-005)** | 156 | 156 | 0 | **100% PASS** |
| **Phase 8 Red Team Probe Suite** | 37 | 37 | 0 | **100% PASS** |
| **Quality Gate 1 Foundation** | 31 | 31 | 0 | **100% PASS** |
| **Quality Gate 2 Core Application** | 1672 | 1672 | 0 | **100% PASS** |

Aucune régression n'a été introduite dans les mécanismes d'authentification JWT, de rate limiting, de sandbox du terminal, de traçabilité d'audit ou de persistance de révisions.

---

## 9. Nouvelles Découvertes & Findings

| ID | Classification | Sévérité | Composant | Description |
| :--- | :--- | :--- | :--- | :--- |
| **P8-REV-01** | **NOT FIXED** | **MEDIUM** | `packages/core/src/ai/providers/types.ts` | **SSRF IPv6 Loopback Bypass :** `[::1]` n'est pas bloqué par `BLOCKED_HOSTS` en raison de la présence de crochets normalisés par l'URL parser. |
| **P8-REV-02** | **HARDENING** | **MEDIUM** | `packages/core/src/ai/providers/types.ts` | **SSRF DNS-Resolution Limitation :** La validation étant purement syntaxique, tout domaine tiers pointant vers une IP privée ou de rebinding contourne l'analyse statique. |
| **P8-REV-03** | **INFORMATIONAL** | **LOW** | `apps/api/src/server.ts` (Ligne 268) | **Shadowing de Route AI Status :** L'interception publique de `GET /api/v1/ai/status` dans `server.ts` masque la résolution de clé locataire de `ai.ts`. |

---

## 10. Synthèse des Risques Résiduels

1. **Risque SSRF Résiduel (Moyen) :**
   - Un locataire malveillant configurant un adaptateur IA personnalisé avec `http://[::1]/` ou un domaine externe pointant vers `127.0.0.1` pourrait sonder des services réseau locaux sur l'hôte si des adaptateurs tiers non filtrés au niveau TCP sont activés.
   - *Mesure d'atténuation existante :* `validateSafeProviderUrl` impose la présence d'une `apiKey` dédiée au locataire, limitant l'exfiltration de clé maître.
2. **Risque d'Environnement / Multi-Tenant (Nul) :**
   - Les injections CRLF et l'écrasement de `default-project` sont totalement résolus et scellés.

---

## 11. Preuves Techniques d'Exécution

- **Harness de Revalidation :** [`scratch/p8_final_revalidation_probes.cjs`](file:///C:/Users/FAYCAL/.gemini/antigravity/brain/8fa9edf0-0fd9-4b9a-aba5-b16114e16dd7/scratch/p8_final_revalidation_probes.cjs)
- **Régression P6 :** 103 tests passés en 753ms.
- **Régression P7 :** 156 tests passés en 2357ms.
- **Gate 2 :** 1672 tests passés en 15.2s.
- **Preuve SSRF IPv6 :**
  ```
  http://[::1]/v1 -> blocked: false (NON BLOQUÉ)
  http://[0:0:0:0:0:0:0:1]/v1 -> blocked: false (NON BLOQUÉ)
  ```

---

## 12. Statut de la Ligne de Base & Décision Finale

> [!WARNING]
> ### **VERDICT GLOBAL : SECURITY BASELINE NOT FROZEN**
> 
> Conformément aux critères stricts de la section 9 :
> *"Déclarer SECURITY BASELINE FROZEN uniquement si : P8-VULN-01 confirmé FIXED, P8-VULN-02 confirmé FIXED, P8-VULN-03 confirmé FIXED, P8-VULN-04 confirmé FIXED... Si le SSRF reste insuffisamment protégé, NE PAS déclarer FROZEN."*
> 
> **P8-VULN-01, P8-VULN-02 et P8-VULN-03 sont confirmés 100% FIXED.**  
> Toutefois, **P8-VULN-04 (SSRF)** présente une faille de désynchronisation syntaxique sur IPv6 (`[::1]`) et une limitation structurelle sur la résolution DNS des domaines tiers.  
> Par rigueur méthodologique et respect de la consigne d'intégrité (*"Ne jamais transformer une incertitude en PASS"*), la baseline de sécurité ne peut pas être déclarée définitivement gelée.

---

## 13. Recommandations pour la Reprise du Développement

La quasi-totalité des vulnérabilités critiques et d'isolation multi-locataires ayant été éliminée, le projet est dans un état de robustesse exceptionnel :
1. **Action SSRF immédiate (Lot simple de durcissement) :**
   - Ajouter `'[::1]'` et `'[0:0:0:0:0:0:0:1]'` dans `BLOCKED_HOSTS` (ou normaliser en retirant les crochets avant lookup).
   - Introduire une vérification IP via `dns.lookup` avant d'émettre des requêtes sortantes vers des providers personnalisés.
2. **Sortie du cycle offensif lourd :**
   - Clôturer les grands cycles d'audit globaux (P6, P7, P8).
   - Intégrer les tests de sécurité P6/P7/P8 au pipeline d'intégration continue standard (CI).
   - Reprendre le développement fonctionnel des fonctionnalités produit Volaco.
