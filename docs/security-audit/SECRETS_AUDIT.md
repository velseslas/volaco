# AUDIT DE GESTION DES SECRETS & IDENTIFIANTS (SECRETS AUDIT REPORT)

**Date d'évaluation :** 11 Septembre 2026  
**Périmètre :** Code source, configurations, environnement, frontend, API, mémoire  
**Auteurs :** Red Team Volaco  

---

## 1. Inventaire des Secrets Identifiés dans le Codebase

### 1.1 Clé Maître Mistral AI Codée en Dur dans le Client Web
* **Localisation :** `apps/studio/index.html:3092` et `apps/studio/index.html:3002`
* **Valeur réelle :** `"zsvQFh3EEZOEkTtHlL51p7NIGRHGTkfg"`
* **Statut de Compromission :** **CONFIRMÉ CRITIQUE (P0)**
* **Mécanisme de fuite :**
  1. Le fichier `apps/studio/index.html` est servi publiquement par `apps/api/src/server.ts:89`.
  2. Le script client initialise automatiquement le `localStorage` :
     ```javascript
     const DEFAULT_MISTRAL_KEY = "zsvQFh3EEZOEkTtHlL51p7NIGRHGTkfg";
     let mistralKey = localStorage.getItem('vibecode_mistral_key') || DEFAULT_MISTRAL_KEY;
     if (!localStorage.getItem('vibecode_mistral_key')) {
       try { localStorage.setItem('vibecode_mistral_key', DEFAULT_MISTRAL_KEY); } catch (e) {}
     }
     ```
  3. Tout utilisateur accédant au Studio reçoit cette clé d'API valide directement dans son navigateur.

### 1.2 Clé Secrète de Signature JWT de Repli
* **Localisation :** `apps/api/src/middleware/auth.ts:18`
* **Valeur réelle :** `'volaco-auth-secret-key-2026-secure'`
* **Statut de Compromission :** **CONFIRMÉ CRITIQUE (P0)**
* **Mécanisme de fuite :**
  Si le serveur est démarré sans variable d'environnement `AUTH_SECRET`, cette valeur publique est utilisée comme clé secrète pour signer et vérifier les jetons JWT HMAC-SHA256. Tout attaquant connaissant cette chaîne peut signer ses propres jetons avec le rôle `OWNER`.

### 1.3 Fuite de Mots de Passe de Base de Données dans `/settings`
* **Localisation :** `packages/core/src/settings/service.ts:13`
* **Expression Régulière Utilisée :**
  ```typescript
  const SENSITIVE_KEY_PATTERN = /(KEY|SECRET|PASSWORD|TOKEN|AUTH|CREDENTIAL|PRIVATE)/i;
  ```
* **Statut de Compromission :** **CONFIRMÉ MOYEN (P2)**
* **Mécanisme de fuite :**
  Les clés contenant des chaînes de connexion avec mot de passe intégré :
  - `DATABASE_URL="postgres://admin:Password123@host:5432/db"`
  - `MONGODB_URI="mongodb://user:SecretPass@cluster0.net"`
  - `REDIS_URL="redis://:RedisAuthPass@cache.internal:6379"`
  ne contiennent aucun des mots-clés de `SENSITIVE_KEY_PATTERN`.
  Par conséquent, lors d'un appel à `GET /api/v1/projects/:id/settings`, la méthode renvoie ces variables **en clair sans aucun masquage**, les exposant à tous les utilisateurs autorisés en lecture (`VIEWER`).

---

## 2. Stockage des Secrets Côté Client

| Secret | Emplacement de Stockage | Chiffrement au Repos | Accessibilité |
| :--- | :--- | :---: | :--- |
| **Clé Mistral** | `localStorage.getItem('vibecode_mistral_key')` | ❌ Aucun (Texte brut) | Accessible par tout script de la même origine ou via l'évasion d'iframe (SEC-007) |
| **Modèle IA** | `localStorage.getItem('vibecode_mistral_model')` | ❌ Aucun (Texte brut) | Modifiable arbitrairement par le client |
| **Projets & Code** | `localStorage.getItem('vibecode_projects_v2')` | ❌ Aucun (Texte brut) | Volable par injection XSS ou évasion de sandbox |

---

## 3. Analyse de la Fonction de Masquage `maskSecret`

* **Fichier :** `packages/core/src/security/secrets.ts:1-9`
```typescript
export function maskSecret(value: string, visibleChars = 4): string {
  if (!value || typeof value !== 'string') return '';
  if (value.length <= visibleChars * 2) {
    return '***';
  }
  const start = value.slice(0, visibleChars);
  const end = value.slice(-visibleChars);
  return `${start}...${end}`;
}
```
* **Constat Red Team :**
La fonction laisse apparaître les 4 premiers et les 4 derniers caractères du secret.  
Pour des clés d'API courtes ou des jetons structurés, la divulgation des 4 premiers et 4 derniers caractères réduit drastiquement l'entropie restante et facilite considérablement les attaques par force brute ou la corrélation d'identifiants fuités dans des logs.
