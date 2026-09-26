# THREAT MODEL OFFENSIF — VOLACO / VIBECODING

**Date d'évaluation :** 11 Septembre 2026  
**Auteurs :** Red Team & Security Engineering Volaco  
**Méthodologie :** Modélisation des Menaces STRIDE + Cartographie des Attaquants Réels

---

## 1. Profils d'Attaquants & Vecteurs de Menace

### A. Attaquant Externe Anonyme
* **Position :** Réseau Internet public, aucun compte préalable sur la plateforme.
* **Capacités :** Envoi de requêtes HTTP forgées avec en-têtes arbitraires, injection de payloads volumineux, balayage d'API, attaques par rebond CORS.
* **Objectifs :** Élever ses privilèges pour créer des projets non autorisés, lire le code source des clients, saturer la mémoire du serveur Node.js (DoS), voler la clé d'API Mistral distribuée sur le frontend.

### B. Attaquant Externe Authentifié (Malicious Tenant)
* **Position :** Possède un compte légitime sur le tenant `tenant_attacker`.
* **Capacités :** Émission de requêtes authentifiées avec Bearer tokens valides pour son tenant, exécution d'analyses IA, création de projets et révisions.
* **Objectifs :** Escalader ses droits vers un autre tenant (`tenant_victim`), accéder aux projets, paramètres, variables d'environnement, code source et historique d'audit de la victime.

### C. Attaquant Interne (Privilege Escalation)
* **Position :** Utilisateur authentifié au sein d'une organisation avec le rôle le plus faible (`VIEWER`).
* **Capacités :** Lecture autorisée des projets (`PROJECT_READ`).
* **Objectifs :** Tenter de contourner la matrice RBAC pour obtenir les rôles `ENGINEER` (`PROJECT_MUTATE`) ou `OWNER` (`TENANT_MANAGE`), écraser le code d'un projet, déclencher des rollbacks non autorisés ou modifier les paramètres sensibles du projet.

### D. Attaquant via Injection IA (Prompt Injection Adversary)
* **Position :** Utilisateur soumettant des prompts ou injectant des fichiers sources contenant des instructions malveillantes indirectes.
* **Capacités :** Concaténation de requêtes textuelles vers Codestral, manipulation du contexte de conversation et des hypothèses d'architecture.
* **Objectifs :** Forcer le modèle LLM à contourner ses consignes système, générer du code JavaScript hostile qui s'exécutera dans le navigateur d'autres utilisateurs ou développeurs, empoisonner l'Application DNA ou la mémoire décisionnelle.

### E. Application Générée Malveillante (Hostile Generated App)
* **Position :** Code HTML/CSS/JS généré par l'IA ou importé dans le projet, exécuté dans le composant de prévisualisation `#wsLiveIframe`.
* **Capacités :** Exécution de code dans le navigateur de la victime.
* **Objectifs :** Tenter de s'évader de l'iframe de prévisualisation, lire les cookies et le `localStorage` du Studio parent, intercepter les événements `postMessage`, sonder le réseau local de l'utilisateur (`192.168.x.x`, `127.0.0.1`) par requêtes `fetch()`.

---

## 2. Analyse STRIDE par Composant Applicatif

| Composant | Spoofing | Tampering | Repudiation | Information Disclosure | Denial of Service | Elevation of Privilege |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **API Gateway / Auth** | **CRITIQUE** (Header spoofing) | **CRITIQUE** (JWT forgeable) | **ÉLEVÉ** (Logs falsifiables) | **MOYEN** (Headers debug) | **ÉLEVÉ** (10 Mo sans rate limit) | **CRITIQUE** (Usurpation OWNER) |
| **Iframe Sandbox** | **MOYEN** (Message forge) | **CRITIQUE** (Parent DOM access) | **FAIBLE** | **CRITIQUE** (Vol Mistral key) | **MOYEN** (Boucle JS infinie) | **CRITIQUE** (Contrôle Studio) |
| **Agent Runtime** | **FAIBLE** | **ÉLEVÉ** (allowBreaking force) | **MOYEN** | **MOYEN** (Context graph leak) | **MOYEN** (Boucle d'outils) | **ÉLEVÉ** (Mutation non supervisée) |
| **FileStore Virtuel** | **FAIBLE** | **FAIBLE** (SanitizePath actif) | **ÉLEVÉ** (Mémoire volatile) | **FAIBLE** | **CRITIQUE** (Crash OOM Tas V8) | **FAIBLE** |
| **Terminal Service** | **NUL** (Zéro shell host) | **NUL** (Mock déterministe) | **NUL** | **FAIBLE** | **NUL** | **NUL** |
| **Settings Service** | **FAIBLE** | **MOYEN** (Modif env vars) | **FAIBLE** | **ÉLEVÉ** (Fuite DATABASE_URL) | **FAIBLE** | **MOYEN** |

---

## 3. Matrice de Risque Global des Menaces

```
  PROBABILITÉ
       ▲
 ÉLEVÉE│  [SEC-004 CORS]   [SEC-002 Headers]  [SEC-001 JWT Forge]
       │                   [SEC-007 Iframe]   [SEC-003 Mistral Key]
       │
MOYENNE│  [SEC-011 CDN]    [SEC-009 Agent]    [SEC-013 Heap DoS]
       │  [SEC-015 Metrics][SEC-010 Prompt]   [SEC-012 DB Creds]
       │
 FAIBLE│  [SEC-005 Path]   [SEC-016 Author]   [SEC-006 Volatilité]
       └────────────────────────────────────────────────────────►
          FAIBLE           MOYEN              CRITIQUE / MAJEUR
                                 IMPACT
```
