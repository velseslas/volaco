# AUDIT D'ISOLATION MULTI-TENANT (TENANT ISOLATION REPORT)

**Périmètre :** Frontières d'étanchéité inter-tenants sur `volaco-core`  
**Standard de preuve :** NO EVIDENCE → NO CLAIM  
**Auteurs :** Red Team Volaco  

---

## 1. Modèle Théorique vs Réalité d'Implémentation

### 1.1 Ce que prévoyait l'Architecture
Le modèle d'architecture de Volaco stipule que chaque ressource (projet, fichier, historique, décision, journal d'audit) appartient strictement à un `tenantId`. Aucun tenant ne doit pouvoir lire, modifier ou supprimer les données d'un autre tenant.

### 1.2 Ce qui est Réellement Implémenté au Niveau Domaine (Packages Core)
Dans les services de domaine de `packages/core`, l'isolation logique est vérifiée :
```typescript
// packages/core/src/identity/project.ts:53-57
public getProject(tenantId: string, id: string): Project | null {
  const project = this.projects.get(id);
  if (!project || project.tenantId !== tenantId) {
    return null;
  }
  return project;
}

// packages/core/src/file-explorer/service.ts:32-44
private assertProjectAccess(tenantId: string, projectId: string, requestId?: string): void {
  const project = this.projectStore.getProject(tenantId, projectId);
  if (!project) {
    throw new NotFoundError(`Projet ${projectId} introuvable pour le tenant ${tenantId}`, requestId);
  }
}
```
**Constat Factuel :** Au niveau du code métier pur, la méthode `getProject` vérifie bien la concordance entre `project.tenantId` et le paramètre `tenantId` fourni en argument. Une tentative d'accéder à `project_victim` avec `tenantId: "tenant_attacker"` renvoie bien une erreur 404 `NotFoundError`.

---

## 2. La Rupture Totale au Niveau Passerelle API

Bien que le domaine interne soit protégé si le `tenantId` est authentique, **la passerelle d'authentification API permet à n'importe quel attaquant d'usurper le `tenantId` en amont**.

### Vecteur 1 : Usurpation par en-tête `X-Tenant-Id` (SEC-002)
* **Preuve de code :** `apps/api/src/middleware/auth.ts:118-121`
```typescript
const rawTenant = req.headers['x-tenant-id'];
const tenantId = typeof rawTenant === 'string' && rawTenant.trim().length > 0
  ? rawTenant.trim()
  : 'tenant_default';
```
Lorsque le serveur fonctionne en mode par défaut (variable `NODE_ENV` non renseignée dans le conteneur ou la machine de déploiement), le serveur extrait directement le `tenantId` de la requête HTTP du client. Un attaquant qui souhaite attaquer `enterprise_alpha` envoie simplement `X-Tenant-Id: enterprise_alpha`. L'API injecte ce tenant dans `context.tenantId`, neutralisant ainsi la vérification `project.tenantId !== tenantId` du domaine.

### Vecteur 2 : Falsification de Token JWT avec le Secret Codé en Dur (SEC-001)
Même si le serveur est exécuté avec `NODE_ENV=production`, si la variable `AUTH_SECRET` n'est pas renseignée, la clé de signature publique `'volaco-auth-secret-key-2026-secure'` est utilisée. L'attaquant forge un token contenant `"tenantId": "enterprise_alpha"` et franchit la passerelle sans obstacle.

---

## 3. Matrice de Tests d'Isolation Inter-Tenants

| Ressource Testée | Endpoint API Associé | Isolation au Niveau Domaine | Résistance à la Passerelle API | Statut Global |
| :--- | :--- | :---: | :---: | :---: |
| **Projets** | `GET /api/v1/projects` | ✅ Vérifiée (Filtre par tenant) | ❌ Bypass via `X-Tenant-Id` / JWT | **VULNÉRABLE** |
| **Fichiers** | `GET /api/v1/projects/:id/files/content` | ✅ Vérifiée (`assertProjectAccess`) | ❌ Bypass via `X-Tenant-Id` / JWT | **VULNÉRABLE** |
| **Révisions** | `GET /api/v1/projects/:id/revisions` | ✅ Vérifiée (`projectStore.getProject`) | ❌ Bypass via `X-Tenant-Id` / JWT | **VULNÉRABLE** |
| **Paramètres & Secrets** | `GET /api/v1/projects/:id/settings` | ✅ Vérifiée (`projectStore.getProject`) | ❌ Bypass via `X-Tenant-Id` / JWT | **VULNÉRABLE** |
| **Journal d'Audit** | `GET /api/v1/audit` | ✅ Vérifiée (`auditStore.query(tenantId)`) | ❌ Bypass via `X-Tenant-Id` / JWT | **VULNÉRABLE** |
| **Métriques Globales** | `GET /api/v1/metrics` | ❌ Aucune isolation (Global singleton) | ❌ Aucune authentification requise | **FUITE GLOBALE** |
| **Cache AINT-017** | `packages/core/src/ai-native/evolution/cache.ts` | ✅ Vérifiée (`${tenantId}:${projectId}`) | ❌ Bypass via `X-Tenant-Id` / JWT | **VULNÉRABLE** |

---

## 4. Conclusion sur l'Isolation Multi-Tenant

L'isolation multi-tenant de Volaco souffre du syndrome du **« château fort aux murs épais dont la herse est restée levée »** :
1. Le cœur applicatif TypeScript vérifie scrupuleusement les frontières de tenant.
2. Mais la porte d'entrée HTTP fait aveuglément confiance aux en-têtes envoyés par le client ou accepte des jetons signés avec un secret public.
3. En conséquence, **un tenant hostile peut immédiatement lire et détruire les ressources de n'importe quel autre tenant** dès lors qu'il connaît ou énumère son `tenantId`.
