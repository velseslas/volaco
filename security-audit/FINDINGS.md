# REGISTRE DÉTAILLÉ DES VULNÉRABILITÉS (FINDINGS SEC-001 À SEC-016)

**Périmètre :** Codebase réel `volaco-core` (`apps/api`, `apps/studio`, `packages/core`)  
**Standard de preuve :** NO EVIDENCE → NO CLAIM. Chaque finding est prouvé par le code réel.

---

### SEC-001 [CRITIQUE] : Clé secrète JWT par défaut codée en dur dans le code source
* **Sévérité :** CRITIQUE (P0) | **CVSS 3.1 :** 9.8 (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H)
* **Confiance :** FACT
* **Composant :** Passerelle d'authentification API
* **Fichier :** `apps/api/src/middleware/auth.ts`
* **Ligne :** 18
* **Preuve de code réel :**
```typescript
export const AUTH_SECRET = process.env.AUTH_SECRET || 'volaco-auth-secret-key-2026-secure';
```
* **Scénario d'attaque :**
Un attaquant externe sans identifiants sur le système génère localement un jeton JSON Web Token signé en HMAC-SHA256 en utilisant la clé publique `'volaco-auth-secret-key-2026-secure'`. Le payload contient `tenantId: "target-enterprise"` et `role: "OWNER"`. L'attaquant envoie ce token dans l'en-tête `Authorization: Bearer <token>`. La méthode `verifyAuthToken` calcule la signature attendue avec cette même clé par défaut et valide le jeton sans erreur.
* **Exploitabilité :** Trivial (script Node.js / Python de 5 lignes, 100% reproductible).
* **Impact :** Contournement complet de l'authentification et du contrôle d'accès. Prise de contrôle totale de tous les tenants.
* **Blast Radius :** Plateforme entière (tous les projets, tous les clients, toutes les données).
* **Remédiation recommandée :**
Refuser le démarrage du serveur si `process.env.AUTH_SECRET` n'est pas défini :
`if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET environnemental obligatoire');`
* **Méthode de vérification :**
Émettre une requête vers `GET /api/v1/projects` avec un token forgé à l'aide de cette clé.

---

### SEC-002 [CRITIQUE] : Contournement complet de l'authentification par en-têtes HTTP
* **Sévérité :** CRITIQUE (P0) | **CVSS 3.1 :** 9.8 (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H)
* **Confiance :** FACT
* **Composant :** Middleware d'authentification
* **Fichier :** `apps/api/src/middleware/auth.ts`
* **Lignes :** 108-125
* **Preuve de code réel :**
```typescript
const isTestOrDev = process.env.NODE_ENV === 'test' || process.env.ALLOW_UNSIGNED_AUTH === 'true' || !process.env.NODE_ENV;

if (!isTestOrDev) {
  throw new UnauthorizedError('Authentification requise: aucun token Bearer fourni', requestId);
}

const rawTenant = req.headers['x-tenant-id'];
const rawRole = req.headers['x-user-role'];

const tenantId = typeof rawTenant === 'string' && rawTenant.trim().length > 0
  ? rawTenant.trim()
  : 'tenant_default';

const role = typeof rawRole === 'string' && ['OWNER', 'ADMIN', 'ENGINEER', 'VIEWER'].includes(rawRole)
  ? (rawRole as Role)
  : 'ENGINEER';
```
* **Scénario d'attaque :**
Dans un environnement de déploiement où `NODE_ENV` n'est pas défini (`!process.env.NODE_ENV === true`), l'attaquant omet l'en-tête `Authorization` et fournit directement :
`X-Tenant-Id: victim_tenant` et `X-User-Role: OWNER`.
Le middleware accepte la requête comme valide et injecte ce contexte dans `RequestContext`.
* **Exploitabilité :** Immédiate (une simple commande `curl -H "X-Tenant-Id: victim" -H "X-User-Role: OWNER"`).
* **Impact :** Accès administratif sans mot de passe à l'ensemble des fonctionnalités API du tenant cible.
* **Blast Radius :** Tous les projets de la plateforme.
* **Remédiation recommandée :**
Supprimer définitivement la clause `!process.env.NODE_ENV`. Ne jamais autoriser d'en-têtes non signés pour dériver l'identité en dehors d'un environnement de test unitaire strictement isolé.
* **Méthode de vérification :**
Lancer `node dist/apps/api/src/server.js` sans variable d'environnement et interroger `GET /api/v1/projects` avec `X-User-Role: OWNER`.

---

### SEC-003 [CRITIQUE] : Clé API Mistral de production exposée dans le HTML public
* **Sévérité :** CRITIQUE (P0) | **CVSS 3.1 :** 8.6 (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:H)
* **Confiance :** FACT
* **Composant :** Client Frontend Studio
* **Fichier :** `apps/studio/index.html`
* **Lignes :** 3002 et 3092
* **Preuve de code réel :**
```javascript
// Ligne 3002 :
<input id="mistralApiKeyInput" type="password" value="zsvQFh3EEZOEkTtHlL51p7NIGRHGTkfg" onchange="saveMistralKey()">

// Ligne 3092 :
const DEFAULT_MISTRAL_KEY = "zsvQFh3EEZOEkTtHlL51p7NIGRHGTkfg";
let mistralKey = localStorage.getItem('vibecode_mistral_key') || DEFAULT_MISTRAL_KEY;
```
* **Scénario d'attaque :**
Tout utilisateur ouvrant l'inspecteur web de son navigateur ou effectuant `curl http://127.0.0.1:3000/` peut extraire cette clé d'API valide et l'utiliser pour effectuer des millions de requêtes sur `https://api.mistral.ai/v1/chat/completions`.
* **Exploitabilité :** Trivial (aucun outil requis, visible dans le code source HTML).
* **Impact :** Épuisement des crédits financiers Mistral AI, déni de service du composant IA, utilisation malveillante du quota.
* **Blast Radius :** Compte Mistral AI de l'organisation.
* **Remédiation recommandée :**
1. Révoquer immédiatement la clé `zsvQFh...` dans la console Mistral AI.
2. Déplacer tous les appels Mistral derrière un endpoint proxy sécurisé côté serveur (`/api/v1/ai/chat`) appliquant des quotas stricts.
* **Méthode de vérification :**
Rechercher la clé dans le HTML servi par le serveur.

---

### SEC-004 [ÉLEVÉ] : Configuration CORS avec repli permissif sur Wildcard
* **Sévérité :** ÉLEVÉ (P1) | **CVSS 3.1 :** 7.5 (CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:N)
* **Confiance :** FACT
* **Composant :** Serveur HTTP API
* **Fichier :** `apps/api/src/server.ts`
* **Lignes :** 41-46
* **Preuve de code réel :**
```typescript
if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
  res.setHeader('Access-Control-Allow-Origin', origin);
} else {
  res.setHeader('Access-Control-Allow-Origin', '*');
}
```
* **Scénario d'attaque :**
Un développeur utilisant Volaco visite simultanément un site web tiers malveillant (`https://evil.com`). Le site `evil.com` émet des requêtes asynchrones en arrière-plan vers `http://127.0.0.1:3000/api/v1/projects`. Le serveur Volaco renvoie `Access-Control-Allow-Origin: *`, permettant au script malveillant de lire les réponses JSON contenant le code source et les données des projets.
* **Exploitabilité :** Élevée (dépend de la navigation de la victime).
* **Impact :** Vol de code source et de données de projet par CSRF / Cross-Origin Read.
* **Remédiation recommandée :**
Restreindre strictement l'en-tête `Access-Control-Allow-Origin` aux origines explicitement autorisées et ne jamais utiliser le repli `*`.

---

### SEC-005 [MOYEN] : Validation sommaire de path traversal dans la distribution statique
* **Sévérité :** MOYEN (P2) | **CVSS 3.1 :** 5.3 (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N)
* **Confiance :** HYPOTHESIS
* **Composant :** Serveur de fichiers statiques
* **Fichier :** `apps/api/src/server.ts`
* **Lignes :** 95-97
* **Preuve de code réel :**
```typescript
const staticStudioFile = pathname.replace(/^\//, '');
if (staticStudioFile && !staticStudioFile.includes('..') && !pathname.startsWith('/api')) {
  const candidateAssetPaths = [
    join('C:/Users/FAYCAL/.gemini/antigravity/scratch/volaco-core/apps/studio', staticStudioFile),
    join(process.cwd(), 'apps/studio', staticStudioFile)
  ];
```
* **Scénario d'attaque :**
Sous environnement Windows, des séparateurs de chemin alternatifs, des chemins absolus ou des noms de périphériques DOS (`NUL`, `CON`, chemins UNC) pourraient potentiellement contourner le simple contrôle `!staticStudioFile.includes('..')`.
* **Exploitabilité :** Faible à Moyenne.
* **Impact :** Lecture potentielle de fichiers arbitraires sur le système de fichiers hôte.
* **Remédiation recommandée :**
Utiliser une vérification canonique basée sur `path.resolve()` et vérifier que le chemin résolu commence strictement par le répertoire racine autorisé.

---

### SEC-006 [MOYEN] : Volatilité totale des stores de données en mémoire vive
* **Sévérité :** MOYEN (P2) | **CVSS 3.1 :** 5.9 (CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:H/A:H)
* **Confiance :** FACT
* **Composant :** Stores de persistance Core (`FileStore`, `ProjectStore`, `RevisionStore`, `AuditStore`)
* **Fichiers :** `packages/core/src/file-explorer/store.ts`, `packages/core/src/identity/project.ts`
* **Preuve de code réel :**
```typescript
export class FileStore {
  private projectFiles = new Map<string, Map<string, StoredEntry>>();
  ...
}
export class ProjectStore {
  private projects = new Map<EntityId, Project>();
  ...
}
```
* **Scénario d'attaque :**
Un attaquant ayant commis une altération de code ou un vol de données provoque un crash du processus Node.js (ou attend son redémarrage). Lors du redémarrage, toutes les structures mémoire sont purgées, y compris le journal d'audit (`AuditStore`). Aucune preuve médico-légale ne subsiste.
* **Impact :** Perte définitive des projets des utilisateurs et destruction de la chaîne d'audit.
* **Remédiation recommandée :**
Connecter les stores à une base de données persistante (PostgreSQL avec RLS) ou à un journal Write-Ahead Log (WAL) synchronisé sur disque.

---

### SEC-007 [CRITIQUE] : Évasion de Sandbox Iframe via `allow-same-origin`
* **Sévérité :** CRITIQUE (P0) | **CVSS 3.1 :** 9.6 (CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:H)
* **Confiance :** FACT
* **Composant :** Sandbox de prévisualisation client
* **Fichier :** `apps/studio/index.html`
* **Ligne :** 1402
* **Preuve de code réel :**
```html
<iframe
  id="wsLiveIframe"
  title="Preview Canvas"
  class="w-full h-full border-0 bg-[#06080e]"
  sandbox="allow-scripts allow-modals allow-forms allow-same-origin allow-popups allow-downloads"
></iframe>
```
* **Scénario d'attaque :**
Une application web générée par l'IA ou modifiée par un utilisateur malveillant contient le code JavaScript suivant :
`const stolenKey = window.parent.localStorage.getItem('vibecode_mistral_key');`
En raison de la présence simultanée de `allow-scripts` et `allow-same-origin` dans l'attribut `sandbox`, le navigateur considère que l'iframe partage l'origine de son document parent (Studio). Le script dans l'iframe accède directement à `window.parent`, lit le `localStorage` et manipule l'interface utilisateur.
* **Exploitabilité :** Immédiate et systématique.
* **Impact :** Compromission intégrale de l'environnement Studio du développeur.
* **Remédiation recommandée :**
Supprimer immédiatement `allow-same-origin` de l'attribut `sandbox` de `#wsLiveIframe` et servir l'iframe sur une origine ou un domaine totalement distinct (ex. `preview.volaco.internal`).

---

### SEC-008 [ÉLEVÉ] : Popout Preview Blob URL ouvert sans `noopener noreferrer`
* **Sévérité :** ÉLEVÉ (P1) | **CVSS 3.1 :** 7.4 (CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:L/A:N)
* **Confiance :** FACT
* **Composant :** Prévisualisation externe
* **Fichier :** `apps/studio/index.html`
* **Lignes :** 4786-4791
* **Preuve de code réel :**
```javascript
function popoutPreview() {
  const blob = new Blob([currentAppHtml || pulseAiExactTemplate], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
```
* **Scénario d'attaque :**
L'utilisateur clique sur le bouton "Ouvrir dans un nouvel onglet". Le code HTML du projet est ouvert via `window.open(url, '_blank')`. La nouvelle page ouverte hérite de l'origine du Studio et possède une référence active vers `window.opener`. Le script dans l'onglet ouvert peut naviguer ou manipuler la fenêtre Studio d'origine.
* **Exploitabilité :** Élevée dès l'ouverture de la prévisualisation dans un nouvel onglet.
* **Impact :** Vol de session parent et manipulation de contexte.
* **Remédiation recommandée :**
Utiliser `window.open(url, '_blank', 'noopener,noreferrer')`.

---

### SEC-009 [FIXED - P0-002] : Forçage autonome des mutations destructives (`allowBreaking` & `allowHighRisk`)
* **Sévérité :** ÉLEVÉ (P1) | **CVSS 3.1 :** 8.1 (CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:H)
* **Confiance :** FACT
* **Composant :** Exécuteur d'agent autonome
* **Fichier :** `packages/core/src/ai-native/agent-runtime/execution/executor.ts`
* **Ligne :** 104
* **Preuve de code réel :**
```typescript
const mutResult = await this.mutationService.executePlan(
  planPayload,
  { dryRun: false, allowBreaking: true, allowHighRisk: true },
  context.userRole,
  context.requestId
);
```
* **Scénario d'attaque :**
Lors de l'exécution d'un plan autonome contenant l'outil `execute_mutation`, l'exécuteur transmet systématiquement `{ allowBreaking: true, allowHighRisk: true }`. Même si une mutation détruit des fichiers critiques ou rompt la compatibilité du code, le service de mutation ne bloque pas l'action et ne demande aucune approbation humaine.
* **Exploitabilité :** Élevée (automatique lors de l'exécution des plans).
* **Impact :** Destruction ou altération non supervisée de fichiers de code source.
* **Remédiation recommandée :**
Exiger un jeton de validation explicite signé par un utilisateur détenant au moins le rôle `ADMIN` pour toute mutation comportant `allowBreaking: true` ou `allowHighRisk: true`.

---

### SEC-010 [FIXED - P0-002] : Concaténation non assainie du prompt utilisateur vers le LLM
* **Sévérité :** ÉLEVÉ (P1) | **CVSS 3.1 :** 7.3 (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:H/A:L)
* **Confiance :** FACT
* **Composant :** Générateur de code IA du Studio
* **Fichier :** `apps/studio/index.html`
* **Ligne :** 9691
* **Preuve de code réel :**
```javascript
const uPrompt = "Conçois l'application web complète suivante : " + text;
```
* **Scénario d'attaque :**
L'utilisateur injecte un texte contenant des instructions de détournement de modèle. Comme le texte est concaténé sans délimiteurs stricts, le modèle Codestral ignore les consignes système et génère du code JavaScript piégé qui est automatiquement injecté dans l'éditeur et l'iframe de prévisualisation.
* **Exploitabilité :** Élevée (Jailbreak / Direct Prompt Injection standard).
* **Impact :** Génération de code hostile exécuté dans le Studio.
* **Remédiation recommandée :**
Utiliser des délimiteurs XML étanches (ex. `<user_request>...</user_request>`) et implémenter un validateur d'intégrité syntaxique du code généré avant injection dans l'iframe.

---

### SEC-011 [ÉLEVÉ] : Dépendances CDN externes chargées sans hash Subresource Integrity (SRI)
* **Sévérité :** ÉLEVÉ (P1) | **CVSS 3.1 :** 7.5 (CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:C/C:H/I:H/A:N)
* **Confiance :** FACT
* **Composant :** En-tête HTML du Studio
* **Fichier :** `apps/studio/index.html`
* **Lignes :** 8-33
* **Preuve de code réel :**
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
```
* **Scénario d'attaque :**
En cas de compromission de l'infrastructure d'un CDN tiers (Cloudflare cdnjs ou Tailwind CDN) ou d'interception réseau (attaque de type Man-in-the-Middle), un script malveillant injecté est exécuté dans le contexte du Studio sans être bloqué par le navigateur.
* **Exploitabilité :** Faible à Moyenne (dépend de la chaîne d'approvisionnement CDN).
* **Impact :** Exécution de code hostile dans le navigateur des développeurs.
* **Remédiation recommandée :**
Ajouter systématiquement les attributs `integrity="sha384-..."` et `crossorigin="anonymous"` sur chaque balise de script externe.

---

### SEC-012 [MOYEN] : Omission du masquage des mots de passe dans les variables `DATABASE_URL`
* **Sévérité :** MOYEN (P2) | **CVSS 3.1 :** 6.5 (CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N)
* **Confiance :** FACT
* **Composant :** Service des paramètres de projet
* **Fichier :** `packages/core/src/settings/service.ts`
* **Lignes :** 13 et 71-76
* **Preuve de code réel :**
```typescript
const SENSITIVE_KEY_PATTERN = /(KEY|SECRET|PASSWORD|TOKEN|AUTH|CREDENTIAL|PRIVATE)/i;

for (const [k, v] of Object.entries(raw.envVars)) {
  if (maskSensitive && SENSITIVE_KEY_PATTERN.test(k)) {
    maskedVars[k] = maskSecret(v);
  } else {
    maskedVars[k] = v;
  }
}
```
* **Scénario d'attaque :**
Un utilisateur configure une variable d'environnement `DATABASE_URL=postgres://admin:TopSecretPassword123@db.prod:5432/app`. Comme le nom de clé `DATABASE_URL` ne correspond pas à la regex `SENSITIVE_KEY_PATTERN`, sa valeur n'est pas masquée. Tout utilisateur ayant le rôle `VIEWER` qui appelle `GET /api/v1/projects/:id/settings` reçoit le mot de passe de la base de données en clair.
* **Exploitabilité :** Immédiate pour tout utilisateur ayant accès en lecture aux paramètres.
* **Impact :** Divulgation d'identifiants de bases de données de production.
* **Remédiation recommandée :**
Compléter la regex pour inclure `(URL|URI|CONN|DATABASE)` et inspecter la valeur elle-même avec un détecteur d'URI contenant des identifiants (`proto://user:pass@host`).

---

### SEC-013 [ÉLEVÉ] : Absence de Rate Limiting et vulnérabilité d'épuisement de tas RAM (Heap DoS)
* **Sévérité :** ÉLEVÉ (P1) | **CVSS 3.1 :** 7.5 (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)
* **Confiance :** FACT
* **Composant :** Serveur HTTP et gestionnaire de corps de requêtes
* **Fichier :** `apps/api/src/middleware/auth.ts`
* **Ligne :** 134
* **Preuve de code réel :**
```typescript
export const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB limit
```
* **Scénario d'attaque :**
L'API autorise jusqu'à 10 Mo par requête et n'impose aucun quota ni limitation de débit. Un attaquant émettant 150 requêtes `PUT /files/content` de 9.9 Mo injecte plus de 1.4 Go de chaînes dans les Maps en mémoire vive, provoquant l'arrêt brutal du processus Node.js par dépassement de tas V8 (`JavaScript heap out of memory`).
* **Exploitabilité :** Élevée (script d'envoi en boucle simple).
* **Impact :** Déni de service complet de la plateforme pour tous les utilisateurs.
* **Remédiation recommandée :**
1. Implémenter un intercepteur de limitation de débit (ex. 60 requêtes/minute par IP/Tenant).
2. Fixer un quota de taille cumulée maximale par projet et par tenant dans `FileStore`.

---

### SEC-014 [MOYEN] : Absence de signature cryptographique et de non-répudiation sur l'AuditStore
* **Sévérité :** MOYEN (P2) | **CVSS 3.1 :** 4.3 (CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N)
* **Confiance :** FACT
* **Composant :** Journal d'audit d'observabilité
* **Fichier :** `packages/core/src/observability/audit.ts`
* **Preuve de code réel :**
```typescript
export class AuditStore {
  private entries: AuditEntry[] = [];
  public record(entry: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
    ...
    this.entries.push(fullEntry);
    return fullEntry;
  }
}
```
* **Scénario d'attaque :**
Les entrées d'audit ne sont pas chaînées cryptographiquement (absence d'arbre de Merkle ou de HMAC par entrée). De plus, elles résident dans un tableau volatil en mémoire, ce qui permet à un administrateur malveillant de nier ses actions en cas d'incident de sécurité.
* **Impact :** Impossibilité d'assurer la traçabilité légale et la non-répudiation des opérations critiques.
* **Remédiation recommandée :**
Signer les entrées d'audit et les transférer de manière asynchrone vers un stockage immuable en écriture seule (WORM / SIEM).

---

### SEC-015 [FAIBLE] : Exposition publique de statistiques globales inter-tenants sur `/metrics`
* **Sévérité :** FAIBLE (P3) | **CVSS 3.1 :** 3.7 (CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N)
* **Confiance :** FACT
* **Composant :** Endpoint d'observabilité
* **Fichier :** `apps/api/src/routes/observability.ts`
* **Ligne :** 16
* **Preuve de code réel :**
```typescript
if (req.method === 'GET' && (pathname === '/metrics' || pathname === '/api/v1/metrics')) {
  const metrics = metricsCollector.getMetricsSummary();
  res.statusCode = 200;
  res.end(JSON.stringify({ metrics, requestId }));
  return true;
}
```
* **Scénario d'attaque :**
Aucune permission (`assertPermission`) n'est exigée sur cette route. Tout utilisateur peut surveiller l'activité globale du serveur, le volume de requêtes par seconde, la latence moyenne et le taux d'erreurs global de tous les autres clients.
* **Impact :** Fuite d'informations statistiques opérationnelles.
* **Remédiation recommandée :**
Exiger la permission `TENANT_MANAGE` ou réserver l'endpoint à un réseau de monitoring interne.

---

### SEC-016 [MOYEN] : Usurpation de l'auteur d'une révision via le champ client `payload.author`
* **Sévérité :** MOYEN (P2) | **CVSS 3.1 :** 5.3 (CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:L/A:N)
* **Confiance :** FACT
* **Composant :** Gestionnaire de versions et révisions
* **Fichier :** `apps/api/src/routes/revisions.ts`
* **Ligne :** 58
* **Preuve de code réel :**
```typescript
const revision = revisionStore.createRevision(context.tenantId, projectId, {
  message: payload.message,
  author: payload.author || 'engineer',
  files: payload.files,
  decisions: payload.decisions || [],
  provenance: payload.provenance || { source: 'USER', triggerRequestId: requestId }
});
```
* **Scénario d'attaque :**
Lors de la création d'une révision, le serveur accepte la chaîne `payload.author` envoyée par le client sans la valider ni la lier au rôle ou à l'identité réelle de l'utilisateur. Un développeur malveillant peut attribuer des modifications suspectes à un collègue ou à un rôle d'administration (`author: "lead_architect"`).
* **Impact :** Falsification de l'historique de version et de la responsabilité des commits.
* **Remédiation recommandée :**
Forcer l'auteur à être dérivé de l'identité authentifiée (`context.role` ou ID utilisateur validé).
