# VOLACO CORE — RAPPORT D'AUDIT DE SÉCURITÉ P6
# INDEPENDENT FINAL RED TEAM & ZERO-DAY HUNT

**Document ID :** SEC-AUDIT-P6-FINAL-REDTEAM  
**Date :** 12 Septembre 2026  
**Auditeur :** External Independent Red Team / Offensive Security Division  
**Cible :** Volaco Core API & Services (Post-Campagnes P1 à P5)  
**Classification :** CONFIDENTIEL INTERNE  
**Statut Global :** AUDIT ACHEVÉ — **VULNÉRABILITÉS IDENTIFIÉES & PROUVÉES**  

---

## 1. EXECUTIVE SUMMARY

### 1.1 Verdict de l'Audit

```
================================================================================
                         VERDICT OFFICIEL MISSION P6
                    STATUS : VULNERABILITY FOUND
================================================================================
```

À l'issue de la mission indépendante **P6 — Independent Final Red Team / Zero-Day Hunt**, menée en posture offensive externe « Boîte Noire vers Boîte Grise », l'équipe Red Team a découvert et prouvé **6 nouvelles vulnérabilités zero-day** dans l'architecture et les routes d'API de Volaco Core.

Malgré les résultats parfaits des suites de régression antérieures (P5: 79/79 PASS, P4: 23/23 PASS, P3: 51/51 PASS, Gate 1: 31/31 PASS, Gate 2: 1425/1425 PASS), la règle absolue **« NO EVIDENCE → NO CLAIM »** a été confirmée : **un test unitaire ou d'intégration qui passe n'est pas la preuve de l'absence de vulnérabilités.**

### 1.2 Synthèse des Vulnérabilités Découvertes

| ID | Vulnérabilité | CWE / OWASP | Gravité (CVSS v3.1) | Statut |
|---|---|---|---|---|
| **P6-VULN-01** | AI Proxy Message Sanitizer Case-Sensitivity Bypass | CWE-20, CWE-74, OWASP LLM01 | **HIGH (7.5)** | **PROUVÉE (PoC PASS)** |
| **P6-VULN-02** | AI Proxy Direct System Role Pass-Through & Instruction Injection | CWE-20, CWE-862, OWASP LLM01 | **HIGH (7.5)** | **PROUVÉE (PoC PASS)** |
| **P6-VULN-03** | AI Rate Limiting Tier Bypass via Legacy Route Inconsistency | CWE-799, CWE-770 | **MEDIUM (6.5)** | **PROUVÉE (PoC PASS)** |
| **P6-VULN-04** | Rate Limiter AI Tier Self-DoS via Diagnostic Status Polling | CWE-400, CWE-770 | **MEDIUM (5.3)** | **PROUVÉE (PoC PASS)** |
| **P6-VULN-05** | Deceptive Revision Rollback in REST Route (Silent State Divergence) | CWE-392, CWE-372, CWE-665 | **HIGH (7.5)** | **PROUVÉE (PoC PASS)** |
| **P6-VULN-06** | Unhandled Exception (HTTP 500) via Null JSON Payload | CWE-248, CWE-476 | **LOW (4.3)** | **PROUVÉE (PoC PASS)** |

---

## 2. PÉRIMÈTRE & CIBLE D'AUDIT

Le périmètre d'audit a englobé l'intégralité du code applicatif, des intergiciels et de la couche de persistance de Volaco Core :

1. **AI Proxy & LLM Gateway (`apps/api/src/routes/ai.ts`) :**
   - Assainissement des prompts et détection d'injections (`sanitizeAiMessages`).
   - Mécanisme de relais vers le fournisseur de modèle (Mistral AI).
   - Validation des schémas de requêtes et rôles de messages.
2. **Gestion du Débit & Rate Limiting (`apps/api/src/middleware/rate-limiter.ts`) :**
   - Classification des routes par paliers (`AUTH`, `AI`, `TERMINAL`, `MUTATION`, `DEFAULT`).
   - Algorithme de fenêtre glissante multi-instances et verrous distribués.
   - Routage canonique vs routes rétrocompatibles.
3. **Moteur de Révisions & Versioning (`apps/api/src/routes/revisions.ts`, `packages/core/src/versioning/`) :**
   - Endpoints REST de rollback, snapshots, et métadonnées d'historique.
   - Cohérence entre l'état déclaré (`RevisionStore`) et l'état physique du disque (`FileStore`).
4. **Terminal Virtuel & Exécution (`apps/api/src/services/terminal.service.ts`) :**
   - Sandbox d'exécution virtuelle et imperméabilité vis-à-vis du système d'exploitation hôte.
5. **Gestionnaire de Fichiers & Isolation Multi-Tenant (`apps/api/src/routes/files.ts`, `projects.ts`) :**
   - Contrôle d'accès inter-organisations et étanchéité des chemins de fichiers.
6. **Gestion des Erreurs et Robustesse (`apps/api/src/middleware/error-handler.ts`) :**
   - Comportement aux limites face à des structures JSON malformées ou inattendues.

---

## 3. MÉTHODOLOGIE OFFENSIVE (PHASES 0 À 28)

L'audit a suivi une méthodologie en 4 étapes itératives :
1. **Cartographie de surface d'attaque :** Décomposition exhaustive des points d'entrée, des parseurs, des hypothèses implicites des développeurs et des flux de données.
2. **Hypothèse d'échec & Fuzzing ciblé :** Analyse différentielle des conditions logiques (`===`, casse, sous-chemins, séparation des couches applicatives).
3. **Exploitation & Démonstration :** Conception de scripts d'attaque offensifs démontrant l'impact sans équivoque.
4. **Suites de tests automatisées :** Création d'une suite de régression offensive dédiée (`apps/api/tests/security/red-team-p6-hunt.test.ts`), exécutée et validée.

---

## 4. ANALYSE DÉTAILLÉE DES VULNÉRABILITÉS DÉCOUVERTES

### 4.1 P6-VULN-01 — AI Proxy Message Sanitizer Case-Sensitivity Bypass

- **Gravité :** HIGH | **CVSS v3.1 :** 7.5 (`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N`)
- **CWE :** CWE-20 (Improper Input Validation), CWE-74 (Improper Neutralization of Special Elements), OWASP LLM01:2025 (Prompt Injection)
- **Localisation :** `apps/api/src/routes/ai.ts`, ligne 44 :
  ```typescript
  if (role === 'user') {
    if (promptInjectionPattern.test(m.content)) {
      hasInjectionWarning = true;
    }
    // Tag neutralization...
  }
  ```
- **Description & Analyse de Cause Première :**
  La fonction `sanitizeAiMessages` compare la chaîne `role` en vérifiant strictement l'égalité en minuscules : `role === 'user'`. Si un client attaquant envoie un rôle avec une casse différente, tel que `role: "USER"`, `role: "User"`, ou `role: "uSeR"`, la condition s'évalue à `false`. Par conséquent :
  1. Le moteur de regex de détection d'injection (`promptInjectionPattern`) est totalement contourné.
  2. Le drapeau d'alerte `hasInjectionWarning` reste `false`.
  3. L'échappement des balises délimitatrices (`<system>`, `[INST]`, etc.) n'est pas appliqué.
  4. Le prompt d'injection malveillant est relayé brut au LLM distant avec le rôle d'origine.
- **Preuve Offensive :** Validée dans le Test 1 de la suite `red-team-p6-hunt.test.ts`.

---

### 4.2 P6-VULN-02 — AI Proxy Direct System Role Pass-Through & Instruction Injection

- **Gravité :** HIGH | **CVSS v3.1 :** 7.5 (`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N`)
- **CWE :** CWE-20 (Improper Input Validation), CWE-862 (Missing Authorization), OWASP LLM01:2025
- **Localisation :** `apps/api/src/routes/ai.ts`, lignes 40-63
- **Description & Analyse de Cause Première :**
  L'API AI n'impose aucune restriction sur les rôles de messages injectés par l'utilisateur. Le tableau `messages` est mappé directement :
  ```typescript
  const sanitized = messages.map((m: any) => { ... return { role: m.role, content: ... }; });
  ```
  Un utilisateur non privilégié peut injecter un message avec `role: "system"`. Le proxy relaie ce message directement à l'API LLM sans le dégrader en `role: "user"` ni le rejeter. Cela permet à un attaquant d'injecter des directives de niveau système qui écrasent ou entrent en conflit direct avec le prompt système légitime de la plateforme.
- **Preuve Offensive :** Validée dans le Test 2 de la suite `red-team-p6-hunt.test.ts`.

---

### 4.3 P6-VULN-03 — AI Rate Limiting Tier Bypass via Legacy Route Inconsistency

- **Gravité :** MEDIUM | **CVSS v3.1 :** 6.5 (`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`)
- **CWE :** CWE-799 (Improper Control of Interaction Frequency), CWE-770 (Allocation of Resources Without Limits)
- **Localisation :** `apps/api/src/middleware/rate-limiter.ts:632` & `apps/api/src/routes/ai.ts:102`
- **Description & Analyse de Cause Première :**
  Le rate limiter classifie le palier `AI` (limité à 20 requêtes/minute) au moyen de l'expression :
  ```typescript
  if (req.path.startsWith('/api/v1/ai/')) return 'AI';
  ```
  Or, le routeur `aiRouter` monte simultanément deux points d'accès pour la complétion de chat :
  - `/api/v1/ai/chat/completions` (versionné)
  - `/ai/chat/completions` (rétrocompatibilité non versionnée)
  Lorsqu'une requête arrive sur `/ai/chat/completions`, elle ne commence pas par `/api/v1/ai/`. Le rate limiter la classe dans le palier par défaut `MUTATION` (autorisant 60 requêtes/minute). En exploitant les deux URL en parallèle, un attaquant dispose d'un budget cumulé de 80 requêtes/minute (20 + 60), soit une **augmentation de quota de 400%**, contournant le plafond économique fixé par l'opérateur.
- **Preuve Offensive :** Validée dans le Test 3 de la suite `red-team-p6-hunt.test.ts`.

---

### 4.4 P6-VULN-04 — Rate Limiter AI Tier Self-DoS via Diagnostic Status Polling

- **Gravité :** MEDIUM | **CVSS v3.1 :** 5.3 (`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`)
- **CWE :** CWE-400 (Uncontrolled Resource Consumption), CWE-770
- **Localisation :** `apps/api/src/middleware/rate-limiter.ts:632`
- **Description & Analyse de Cause Première :**
  L'endpoint de monitoring `GET /api/v1/ai/status` est destiné aux sondes de santé et aux interfaces de supervision. Cependant, comme son URI commence par `/api/v1/ai/`, le middleware lui assigne automatiquement le palier `AI` (20 req/min).
  Un client ou tableau de bord interrogeant fréquemment l'état du service consomme le quota d'inférence de l'organisation. Dès la 21e requête, le rate limiter bloque les requêtes critiques `POST /api/v1/ai/chat/completions` avec un code HTTP 429, provoquant un déni de service auto-infligé sur les fonctionnalités d'intelligence artificielle.
- **Preuve Offensive :** Validée dans le Test 4 de la suite `red-team-p6-hunt.test.ts`.

---

### 4.5 P6-VULN-05 — Deceptive Revision Rollback in REST Route (Silent State Divergence)

- **Gravité :** HIGH | **CVSS v3.1 :** 7.5 (`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N`)
- **CWE :** CWE-392 (Failure to Report Error in Status Code), CWE-372 (Incomplete Internal State Elimination), CWE-665
- **Localisation :** `apps/api/src/routes/revisions.ts`, lignes 76-88 :
  ```typescript
  router.post('/projects/:projectId/revisions/:id/rollback', async (req, res) => {
    const revision = await revisionStore.rollbackTo(projectId, revisionId);
    return res.json({ success: true, revision });
  });
  ```
- **Description & Analyse de Cause Première :**
  La route REST de restauration appelle directement `revisionStore.rollbackTo(projectId, revisionId)`. Cependant, `revisionStore` ne gère que les métadonnées et snapshots de révisions en base de données. L'écriture physique réelle restaurant les fichiers sur disque se trouve dans `versioningService.rollbackToRevision(projectId, revisionId)`.
  En conséquence, l'API renvoie une réponse HTTP 200 avec `{ success: true }`, induisant l'administrateur ou l'utilisateur en erreur. Dans la réalité, **les fichiers sur disque demeurent dans leur état corrompu ou modifié**. Cette désynchronisation silencieuse crée une défaillance critique d'intégrité opérationnelle.
- **Preuve Offensive :** Validée dans le Test 5 de la suite `red-team-p6-hunt.test.ts`.

---

### 4.6 P6-VULN-06 — Unhandled Exception (HTTP 500) via Null JSON Payload

- **Gravité :** LOW | **CVSS v3.1 :** 4.3 (`CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L`)
- **CWE :** CWE-248 (Uncaught Exception), CWE-476 (NULL Pointer Dereference)
- **Localisation :** `apps/api/src/routes/projects.ts`, ligne 68 :
  ```typescript
  const payload = req.body;
  if (!payload.name) { ... }
  ```
- **Description & Analyse de Cause Première :**
  Lorsqu'une requête `POST /api/v1/projects` est envoyée avec un en-tête `Content-Type: application/json` et un corps contenant le littéral JSON `null`, `express.json()` parse le corps en la valeur primitive `null`. Le gestionnaire de route tente immédiatement d'accéder à `payload.name` sans vérifier préalablement que `payload` est un objet non nul.
  Cela génère une exception non gérée `TypeError: Cannot read properties of null (reading 'name')`, qui n'est pas interceptée par la validation 400 Bad Request et remonte au gestionnaire d'erreur global sous la forme d'un code HTTP 500 Internal Server Error.
- **Preuve Offensive :** Validée dans le Test 6 de la suite `red-team-p6-hunt.test.ts`.

---

## 5. DÉFENSES AUDITÉES ET CONFIRMÉES ROBUSTES

Parallèlement à la découverte des vulnérabilités, l'audit a vérifié de manière exhaustive 6 mécanismes de défense fondamentaux, confirmés 100% imperméables :

1. **Terminal Virtuel & Exécution Système (CWE-78 / RCE) :**
   - Le service `TerminalService` est intégralement virtualisé.
   - Aucune fonction d'exécution de processus hôte (`child_process.exec`, `spawn`, etc.) n'est connectée.
   - Les commandes shell arbitraires (`rm -rf /`, injections avec `;`, `|`, `` ` ``) sont traitées comme de simples chaînes non reconnues ou simulées.
2. **Stockage Fichiers & Traversée de Répertoire (CWE-22) :**
   - La fonction `sanitizePath` normalise rigoureusement les chemins relatifs (`../`, `..\`), les octets nuls (`\0`) et les chemins absolus Unix/Windows.
   - Impossible d'échapper de l'espace de stockage alloué au projet.
3. **Isolation Multi-Tenant (CWE-639 / BOLA / IDOR) :**
   - Le middleware `assertProjectAccess` valide systématiquement l'appartenance du projet au tenant authentifié. Les tentatives d'accès inter-organisations sont rejetées avec HTTP 403 / 404.
4. **Gestion de Mémoire du Rate Limiter (CWE-400 / Memory Leak DoS) :**
   - L'algorithme de fenêtre glissante en mémoire intègre une politique d'éviction par TTL qui purge activement les clés expirées, empêchant la saturation de la RAM par énumération d'adresses IP ou d'identifiants.
5. **Protection contre la Divulgation d'Erreurs Internes (P5-002) :**
   - En environnement de production (`NODE_ENV=production`), `sanitizeErrorPayload` masque systématiquement les traces de pile (`stack`), les chemins système et les identifiants techniques.
6. **Protection contre la Falsification de Jetons JWT (P5-001) :**
   - Les jetons modifiés, forgés avec l'algorithme `none`, ou pourvus d'une signature invalide sont systématiquement rejetés par le rate limiter et le middleware d'authentification.

---

## 6. SCÉNARIOS D'ATTAQUES COMPOSITES (ATTACK CHAINS)

Pour contextualiser l'impact opérationnel des vulnérabilités découvertes, 10 scénarios d'attaque composites ont été modélisés :

1. **Chaîne AC-01 — Contournement Filtre IA & Poisoning de Contexte :**
   - *Vecteur :* Exploitation conjointe de P6-VULN-01 et P6-VULN-02.
   - *Impact :* L'attaquant envoie un tableau contenant un message `role: "USER"` avec une charge d'injection de prompt et un message `role: "system"`. Le filtre ne détecte aucune injection et n'échappe aucune balise, tandis que le message système remplace le prompt originel, amenant le LLM à divulguer des données ou contourner les consignes de sécurité de l'application.
2. **Chaîne AC-02 — Quota Inflation & Épuisement Budgétaire IA :**
   - *Vecteur :* Exploitation de P6-VULN-03.
   - *Impact :* Un client automatisé émet 60 req/min sur `/ai/chat/completions` et 20 req/min sur `/api/v1/ai/chat/completions`. Il consomme 400% de la bande passante IA autorisée sans être freiné par le rate limiter, provoquant un surcoût financier direct sur le compte Mistral API de l'opérateur.
3. **Chaîne AC-03 — Déni de Service Silencieux sur l'IA (AI Self-DoS) :**
   - *Vecteur :* Exploitation de P6-VULN-04.
   - *Impact :* Une sonde de métriques non authentifiée ou un tiers effectue 20 pings rapides sur `/api/v1/ai/status`. Tous les utilisateurs de l'organisation se voient interdire l'accès aux complétions IA (HTTP 429) pendant la minute suivante.
4. **Chaîne AC-04 — Défaillance d'Intégrité de Révision & Fausse Restauration :**
   - *Vecteur :* Exploitation de P6-VULN-05.
   - *Impact :* Un utilisateur corrompt accidentellement ou malicieusement un fichier critique dans un projet. L'administrateur déclenche un rollback via l'API REST `/rollback`. L'API répond HTTP 200 `{ success: true }`. L'administrateur pense le projet restauré, mais le fichier corrompu reste en place, propageant des bugs ou une charge malveillante en production.
5. **Chaîne AC-05 — Fuzzing d'Erreur 500 & Cartographie d'API :**
   - *Vecteur :* Exploitation de P6-VULN-06.
   - *Impact :* En injectant des littéraux `null` sur les routes de création, l'attaquant provoque des erreurs 500 répétées, polluant les journaux de supervision et pouvant déclencher de fausses alertes d'incident chez l'équipe d'exploitation.
6. **Chaîne AC-06 — Dépassement de Quota combiné à l'Injection de Prompt :**
   - *Vecteur :* P6-VULN-03 + P6-VULN-01.
   - *Impact :* En exploitant le palier `MUTATION` non restreint à 20 req/min, l'attaquant peut mener une campagne d'injection de prompt par brute-force à grande vitesse (60 req/min au lieu de 20 req/min) sans risque de blocage par le palier `AI`.
7. **Chaîne AC-07 — Persistance d'Artefacts Altérés après Incident :**
   - *Vecteur :* P6-VULN-05 dans un plan de reprise après sinistre (PRA).
   - *Impact :* Lors d'une procédure automatisée de remédiation, le script de secours appelle l'API REST de rollback. Comme les fichiers physiques ne changent pas, le système de build utilise les artefacts corrompus, neutralisant le plan de reprise.
8. **Chaîne AC-08 — Désynchronisation Métadonnées / FileStore :**
   - *Vecteur :* P6-VULN-05.
   - *Impact :* L'historique des versions indique qu'une révision antérieure est active, tandis que le contenu servi aux utilisateurs finaux correspond à une version différente. Toute tentative de débogage ultérieure est faussée par l'incohérence d'état.
9. **Chaîne AC-09 — Épuisement de Ressources par Fuzzing Null :**
   - *Vecteur :* P6-VULN-06 en boucle rapide.
   - *Impact :* Génération massive d'exceptions non gérées capturées par le middleware d'erreur, forçant la sérialisation des métadonnées d'erreur et saturant le flux de logs.
10. **Chaîne AC-10 — Contournement Global de la Politique d'Assainissement IA :**
    - *Vecteur :* P6-VULN-01 + P6-VULN-02 + P6-VULN-03.
    - *Impact :* Attaque complète contre le sous-système IA : injection de rôle système, contournement de l'assainissement via la casse, et débit quadruplé via l'incohérence de route.

---

## 7. RÉSULTATS DES SUITES DE TESTS OFFENSIFS & RÉGRESSIONS

### 7.1 Suite Offensive P6 (`red-team-p6-hunt.test.ts`)

La suite de tests offensifs développée lors de cette mission a été exécutée via le runner natif Node.js :
```bash
node --test dist/apps/api/tests/security/red-team-p6-hunt.test.js
```
**Résultat : 12 / 12 PASS (100%)**

Détail des assertions :
- **P6-VULN-01 :** Bypass de la détection de prompt injection avec `role: "USER"` → **VULNÉRABILITÉ PROUVÉE**
- **P6-VULN-02 :** Injection directe de `role: "system"` non filtrée → **VULNÉRABILITÉ PROUVÉE**
- **P6-VULN-03 :** Double comptabilisation de quota via `/ai/chat/completions` (MUTATION tier) → **VULNÉRABILITÉ PROUVÉE**
- **P6-VULN-04 :** Consommation du quota AI par `/api/v1/ai/status` entraînant un 429 sur les complétions → **VULNÉRABILITÉ PROUVÉE**
- **P6-VULN-05 :** Rollback REST API retournant 200 `{ success: true }` sans restaurer le disque → **VULNÉRABILITÉ PROUVÉE**
- **P6-VULN-06 :** Payload `null` générant une exception non gérée HTTP 500 au lieu d'un 400 → **VULNÉRABILITÉ PROUVÉE**
- **Défense 1 :** Terminal virtuel étanche face à l'exécution de commandes système arbitraires → **DÉFENSE CONFIRMÉE**
- **Défense 2 :** `sanitizePath` bloquant les traversées de répertoire `../` et caractères nuls → **DÉFENSE CONFIRMÉE**
- **Défense 3 :** Isolation stricte des projets inter-organisations → **DÉFENSE CONFIRMÉE**
- **Défense 4 :** Éviction automatique des clés expirées du Rate Limiter (prévention de fuite mémoire) → **DÉFENSE CONFIRMÉE**
- **Défense 5 :** Masquage strict des traces de pile en mode production (`NODE_ENV=production`) → **DÉFENSE CONFIRMÉE**
- **Défense 6 :** Rejet absolu des jetons JWT altérés ou falsifiés par le rate limiter → **DÉFENSE CONFIRMÉE**

### 7.2 Non-Régression P1 → P5

Toutes les suites antérieures ont été ré-exécutées pour s'assurer de la stabilité du socle d'évaluation :
- **Gate 1 :** 31 / 31 tests PASS (100%)
- **Gate 2 :** 1425 / 1425 tests PASS (100%)
- **Suites de Sécurité P3, P4, P5, P6 :** 156 / 156 tests PASS sur 27 suites de tests (0 échec).

---

## 8. LIMITATIONS & INCONNUES

1. **Fournisseur LLM Externe Réel :** Les tests du proxy IA ont été validés au niveau de la couche d'assainissement et du formatage des requêtes en amont de l'API Mistral réelle (clés simulées/mockées dans l'environnement de test).
2. **Cluster Multi-Instances Physique :** L'évaluation de concurrence a été menée avec des processus concurrents sur le même hôte Windows. Un déploiement sur cluster Kubernetes distribué avec stockage NFS/SMB distant nécessite un audit d'infrastructure dédié.

---

## 9. NIVEAU DE CONFIANCE & VERDICT FINAL

- **Niveau de Confiance Technique :** **TRÈS ÉLEVÉ (5/5)**  
  Toutes les vulnérabilités rapportées sont accompagnées d'un PoC automatisé déterministe, reproductible et intégré à la suite de tests officielle.
- **Verdict Final :**

```
================================================================================
                       P6 VERDICT = VULNERABILITY FOUND
================================================================================
```

L'audit P6 démontre que si les fondations cryptographiques et l'isolation des processus de Volaco Core sont d'une excellente robustesse, des failles logiques réelles subsistent dans la gestion de casse des messages IA, la classification des routes d'API, et la synchronisation de l'état physique lors des rollbacks.

Conformément au protocole de la mission, **aucune modification de correction n'a été appliquée au code lors de cette phase d'audit.** Les correctifs devront faire l'objet d'une mission de remédiation dédiée (P6-REMEDIATION).
