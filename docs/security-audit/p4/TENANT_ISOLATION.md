# AUDIT DE L'ÉTANCHÉITÉ MULTI-TENANT (TENANT_ISOLATION)

## 1. Principe d'Herméticité Absolue

Dans une architecture multi-tenant, la fuite d'informations inter-locataires ou la corruption croisée constitue une vulnérabilité critique de niveau maximal. Le système `volaco-core` a été conçu selon le principe d'étanchéité cryptographique et structurelle.

## 2. Vecteurs d'Attaque Testés et Résultats

| Sous-Système | Scénario d'Attaque | Résultat Attendu | Résultat Observé |
|---|---|---|:---:|
| **Projects Store** | Locataire B tente d'accéder au projet du Locataire A par son ID direct | 404 Not Found (Dissimulation d'existence) | **PASS** (`P4-TENANT-01`) |
| **Project Catalog** | Locataire B liste les projets existants (`GET /api/v1/projects`) | Visibilité restreinte à ses propres projets | **PASS** (`P4-TENANT-02`) |
| **Injection Body** | Requête authentifiée sous Locataire A avec `"tenantId": "tenant-B"` dans le JSON | Écrasement unilatéral par le tenant du JWT | **PASS** (`P4-TENANT-03`) |
| **Audit Trail** | Locataire B consulte le journal d'audit (`GET /api/v1/audit`) | 0 événement du Locataire A dans la réponse | **PASS** (`P4-TENANT-04`) |
| **File Explorer** | Lecture de fichier avec chemin vers un autre projet ou locataire | 403 Forbidden ou 404 Not Found | **PASS** |
| **Revisions** | Rollback ou consultation de snapshot d'un autre tenant | Rejet immédiat avec ForbiddenError | **PASS** |

## 3. Stockage Ségrégué

Toutes les clés de stockage durables sont préfixées par le `tenantId` (ex: `${tenantId}:${projectId}`). Même en cas d'accès direct au fichier de données sous-jacent, chaque entité conserve son isolation logique formelle.
