# PLAN D'ACTION DE REMÉDIATION PRIORISÉ (REMEDIATION PRIORITY)

**Date :** 11 Septembre 2026  
**Auteurs :** Red Team Volaco  
**Règle d'engagement :** Ce document constitue la feuille de route technique pour la phase ultérieure de durcissement. **Aucune modification de code n'a été effectuée pendant la phase d'audit.**

---

## 1. Vue d'Ensemble des Sprints de Remédiation

```
┌────────────────────────────────────────────────────────────────────────┐
│ SPRINT 1 : VERROUILLAGE D'URGENCE P0 (Bloquants de Production)         │
│ • Correctif SEC-002 : Suppression du bypass par en-têtes non signés    │
│ • Correctif SEC-001 : Secret JWT obligatoire et suppression du fallback│
│ • Correctif SEC-003 : Révocation clé Mistral & Proxy serveur           │
│ • Correctif SEC-007 : Retrait allow-same-origin de l'iframe preview    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ SPRINT 2 : DURCISSEMENT APPLICATIF P1 (Haute Priorité)                │
│ • Correctif SEC-013 : Mise en place Rate Limiting & Quotas FileStore   │
│ • Correctif SEC-009 : Garde-fou humain pour mutations allowBreaking    │
│ • Correctif SEC-004 : Restriction CORS stricte                        │
│ • Correctif SEC-008 : Ajout noopener noreferrer sur popout preview     │
│ • Correctif SEC-010 : Délimiteurs XML stricts pour les prompts IA      │
│ • Correctif SEC-011 : Ajout des attributs SRI sur les scripts CDN      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ SPRINT 3 : RÉSILIENCE & CONFORMITÉ P2/P3 (Moyenne/Faible Priorité)    │
│ • Correctif SEC-012 : Regex de masquage pour DATABASE_URL             │
│ • Correctif SEC-006 : Persistance immuable (PostgreSQL / WAL)         │
│ • Correctif SEC-014 : Signature cryptographique du journal d'audit    │
│ • Correctif SEC-016 : Liaison stricte de author dans les révisions    │
│ • Correctif SEC-015 : Restriction de l'endpoint /metrics              │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Détail Technique des Actions par Priorité

### SPRINT 1 : P0 — ACTIONS D'URGENCE IMMÉDIATES

#### Action 1.1 : Verrouillage de la Passerelle d'Authentification (SEC-001 & SEC-002)
* **Fichier Cible :** `apps/api/src/middleware/auth.ts`
* **Impact :** Élimine le vecteur d'élévation `OWNER` sans mot de passe et la falsification de tokens.
* **Exploitabilité Initiale :** Trivial.
* **Effort :** Très Faible (< 20 lignes).
* **Dépendances :** Aucune.
* **Modification requise lors de la phase de correction :**
  1. Exiger obligatoirement `process.env.AUTH_SECRET` au démarrage du serveur :
     ```typescript
     if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
       throw new Error('FATAL: AUTH_SECRET obligatoire (minimum 32 caractères)');
     }
     ```
  2. Supprimer définitivement la dérivation d'identité à partir des en-têtes `X-Tenant-Id` et `X-User-Role` en dehors de l'environnement de test automatisé strict.

#### Action 1.2 : Révocation et Proxyfication de la Clé Mistral AI (SEC-003)
* **Fichiers Cibles :** `apps/studio/index.html`, `apps/api/src/routes/`
* **Impact :** Protège le compte financier Mistral AI et sanctuarise la clé dans l'environnement serveur.
* **Exploitabilité Initiale :** Immédiate.
* **Effort :** Moyen.
* **Dépendances :** Création d'un endpoint proxy `/api/v1/ai/completions`.
* **Modification requise lors de la phase de correction :**
  1. Révoquer immédiatement la clé compromise `zsvQFh3EEZOEkTtHlL51p7NIGRHGTkfg` sur le portail Mistral AI.
  2. Supprimer toute occurrence de la clé et de son champ de saisie dans le code client.
  3. Rediriger les requêtes d'autocomplétion vers l'API interne Volaco qui portera la clé en variable d'environnement serveur.

#### Action 1.3 : Sanctuarisation de l'Iframe Sandbox (SEC-007)
* **Fichier Cible :** `apps/studio/index.html:1402`
* **Impact :** Empêche l'évasion de sandbox et protège le `localStorage` du Studio.
* **Exploitabilité Initiale :** Immédiate.
* **Effort :** Très Faible (1 attribut HTML).
* **Dépendances :** Aucune.
* **Modification requise lors de la phase de correction :**
  Retirer le drapeau `allow-same-origin` de l'attribut `sandbox` :
  ```html
  sandbox="allow-scripts allow-modals allow-forms allow-popups allow-downloads"
  ```

---

### SPRINT 2 : P1 — DURCISSEMENT APPLICATIF

| ID Action | Vulnérabilité Traitée | Composant | Effort | Dépendances |
| :--- | :--- | :--- | :---: | :--- |
| **Action 2.1** | **SEC-013** : Rate Limiting & Quotas | `apps/api/src/server.ts` | Moyen | Création d'un middleware token-bucket |
| **Action 2.2** | **SEC-009** : Approbation des mutations à risque | `packages/core/.../executor.ts` | Faible | Modification des drapeaux par défaut |
| **Action 2.3** | **SEC-004** : Durcissement CORS | `apps/api/src/server.ts` | Faible | Retrait du wildcard `*` |
| **Action 2.4** | **SEC-008** : Protection Popout Window | `apps/studio/index.html` | Très Faible | Paramètre `'noopener,noreferrer'` |
| **Action 2.5** | **SEC-010** : Délimiteurs de prompt IA | `apps/studio/index.html` | Faible | Encodage des prompts utilisateur |
| **Action 2.6** | **SEC-011** : Attributs SRI sur les scripts CDN | `apps/studio/index.html` | Faible | Ajout des hashes SHA-384 |

---

### SPRINT 3 : P2 & P3 — RÉSILIENCE & TRAÇABILITÉ

| ID Action | Vulnérabilité Traitée | Composant | Effort | Dépendances |
| :--- | :--- | :--- | :---: | :--- |
| **Action 3.1** | **SEC-012** : Masquage DATABASE_URL | `packages/core/src/settings/` | Faible | Extension de la regex `SENSITIVE_KEY` |
| **Action 3.2** | **SEC-006** : Persistance non-volatile | `packages/core/src/.../store.ts`| Élevé | Base de données persistante PostgreSQL |
| **Action 3.3** | **SEC-014** : Chaîne d'audit signée | `packages/core/src/observability/`| Moyen | Hachage chaîné SHA-256 dans l'AuditStore |
| **Action 3.4** | **SEC-016** : Liaison stricte author révision | `apps/api/src/routes/revisions.ts`| Faible | Forcer `author: context.role` |
| **Action 3.5** | **SEC-015** : Authentification `/metrics` | `apps/api/src/routes/observability.ts`| Très Faible | Ajout de `assertPermission` |
