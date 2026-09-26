# AUTOPSIE DE SÉCURITÉ OFFENSIVE GLOBALE (SECURITY AUTOPSY MASTER)

**Date d'évaluation :** 11 Septembre 2026  
**Auteurs :** Red Team & Security Engineering Volaco  
**Périmètre :** Repository intégral `volaco-core` (`apps/api`, `apps/studio`, `packages/core`)  
**Statut d'engagement :** Audit offensif statique et dynamique sans modification de code applicatif.  

---

## 1. Vue d'Ensemble & Index des Livrables d'Audit

Dans le cadre de cette autopsie de sécurité exhaustive, 14 documents d'évaluation ont été produits et sont disponibles dans le répertoire `/security-audit/` :

```
/security-audit/
├── SECURITY_AUTOPSY.md       [Document maître de synthèse]
├── EXECUTIVE_SUMMARY.md      [Synthèse exécutive, score et verdict]
├── THREAT_MODEL.md           [Modélisation des menaces et profils d'attaquants]
├── ATTACK_SURFACE.md         [Cartographie complète de la surface d'attaque]
├── FINDINGS.md               [Catalogue détaillé des 16 vulnérabilités SEC-001 à SEC-016]
├── ATTACK_CHAINS.md          [6 scénarios d'exploitation de bout en bout]
├── TENANT_ISOLATION.md       [Audit approfondi de l'étanchéité multi-tenant]
├── AI_SECURITY.md            [Sécurité des prompts, agents, outils et mémoire]
├── SANDBOX_SECURITY.md       [Confinement iframe preview et isolation host]
├── API_SECURITY_MATRIX.md    [Inventaire de sécurité des 38 endpoints HTTP]
├── AINT_SECURITY_MATRIX.md   [Évaluation inter-modules AINT-001 à AINT-017]
├── SECRETS_AUDIT.md          [Audit de détection et de fuite des secrets]
├── SECURITY_SCORE.md         [Formule de calcul et justification de la note 48.5/100]
└── REMEDIATION_PRIORITY.md   [Plan d'action priorisé par sprints de durcissement]
```

---

## 2. Réponses Formelles aux 10 Questions du Critère de Fin

### Q1 : Un utilisateur peut-il accéder aux données d'un autre tenant ?
**OUI (CONFIRMÉ).**  
*Preuve :* Bien que le cœur applicatif applique `project.tenantId !== tenantId`, la passerelle d'authentification (`apps/api/src/middleware/auth.ts:118`) permet à n'importe quel attaquant d'injecter l'en-tête `X-Tenant-Id: <victime>` en mode par défaut (SEC-002) ou de forger un jeton signé avec la clé de repli publique codée en dur (SEC-001). L'attaquant contourne ainsi l'isolation et accède à tous les projets du tenant cible.

### Q2 : Un utilisateur peut-il élever ses privilèges ?
**OUI (CONFIRMÉ).**  
*Preuve :* Un utilisateur anonyme ou détenant le rôle le plus restreint (`VIEWER`) peut s'attribuer le rôle `OWNER` d'un simple en-tête `X-User-Role: OWNER` (SEC-002) ou en forgeant un token avec le secret codé en dur (SEC-001), lui accordant les permissions `PROJECT_CREATE`, `PROJECT_UPDATE`, `PROJECT_MUTATE`, `PROJECT_DELETE` et `TENANT_MANAGE`.

### Q3 : Un agent peut-il appeler un outil qu'il ne devrait pas pouvoir appeler ?
**NON (VERIFIED SAFE pour l'invocation directe) MAIS OUI SUR L'IMPACT DE L'OUTIL.**  
*Preuve :* Le `ToolRegistry` (`packages/core/src/ai-native/agent-runtime/tools/registry.ts`) valide les permissions pour chaque outil. Cependant, lorsqu'il exécute l'outil `execute_mutation`, l'exécuteur de plan de l'agent force programmatiquement `allowBreaking: true, allowHighRisk: true` (`executor.ts:104`, SEC-009), permettant d'écraser ou de supprimer des fichiers critiques sans approbation humaine.

### Q4 : Une prompt injection peut-elle provoquer une action dangereuse ?
**OUI (CONFIRMÉ).**  
*Preuve :* Le champ texte du chat est directement concaténé dans le prompt envoyé à Codestral (`apps/studio/index.html:9691`, SEC-010). Un prompt piégé peut forcer le modèle à générer du code JavaScript offensif qui est ensuite exécuté dans l'iframe de prévisualisation.

### Q5 : Une application générée peut-elle sortir du sandbox ?
**OUI (CONFIRMÉ).**  
*Preuve :* L'iframe `#wsLiveIframe` utilise `sandbox="allow-scripts allow-modals allow-forms allow-same-origin allow-popups allow-downloads"` (`index.html:1402`, SEC-007). Selon la norme W3C HTML5, la combinaison de `allow-scripts` et `allow-same-origin` permet au script exécuté dans l'iframe d'accéder sans restriction à l'objet `window.parent`, de lire le `localStorage` du Studio et de manipuler le DOM parent.

### Q6 : Un secret peut-il atteindre le modèle, le navigateur ou l'application générée ?
**OUI (CONFIRMÉ).**  
*Preuve :*
1. La clé d'API Mistral de production `zsvQFh3EEZOEkTtHlL51p7NIGRHGTkfg` est livrée directement dans le code source HTML public distribué aux navigateurs (`index.html:3092`, SEC-003).
2. Les mots de passe de bases de données dans `DATABASE_URL` ne sont pas masqués par `packages/core/src/settings/service.ts:13` (SEC-012) et sont renvoyés en clair dans les réponses de l'API.

### Q7 : Une application malveillante peut-elle attaquer l'infrastructure Volaco ?
**NON POUR L'HOST SYSTÈME, OUI POUR LE SERVEUR NODE.JS (DoS).**  
*Preuve :*
1. L'application ne peut pas attaquer le système d'exploitation de l'hôte via des commandes shell car `TerminalService` est un simulateur déterministe en mémoire sans aucun appel à `child_process`.
2. En revanche, un attaquant peut saturer la mémoire vive du serveur HTTP en envoyant des requêtes de 10 Mo en continu (SEC-013), provoquant un arrêt immédiat du serveur par dépassement du tas JavaScript (Heap OOM).

### Q8 : Un module AINT peut-il contourner les protections d'un autre module ?
**OUI (CONFIRMÉ).**  
*Preuve :* L'Agent Runtime (**AINT-007**) neutralise les gardes-fous de compatibilité et de risque du Mutation Orchestrator (**AINT-006**) en forçant `allowBreaking: true` et `allowHighRisk: true` dans `executor.ts:104`.

### Q9 : Une attaque peut-elle provoquer une explosion de coûts ou de ressources ?
**OUI (CONFIRMÉ).**  
*Preuve :*
1. **Explosion financière :** La clé d'API Mistral publique (SEC-003) peut être utilisée par des tiers pour générer des millions de tokens aux frais de Volaco.
2. **Épuisement mémoire :** L'absence de Rate Limiting et la limite de corps de 10 Mo (SEC-013) permettent de crasher le serveur en quelques secondes.

### Q10 : Existe-t-il une chaîne d'attaque permettant de passer d'un utilisateur non privilégié à un contrôle significatif de la plateforme ?
**OUI (CONFIRMÉ).**  
*Preuve :* La Chaîne d'Attaque n°1 (`ATTACK_CHAINS.md`) démontre qu'un utilisateur anonyme peut, via l'envoi d'en-têtes HTTP non signés (`X-Tenant-Id` et `X-User-Role: OWNER`), obtenir les droits administratifs complets sur le tenant de son choix, lire son code source, créer des projets et déclencher des mutations.

---

## 3. Verdict Final Red Team

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                    VERDICT FINAL DE L'ÉQUIPE RED TEAM                     ║
║                                                                           ║
║                 STATUT GLOBAL : CONDITIONAL NO-GO STRICT                  ║
║                                                                           ║
║  Le développement du module AINT-017 (ou de tout nouveau module           ║
║  fonctionnel) DOIT ÊTRE SUSPENDU.                                         ║
║  La plateforme Volaco présente 4 vulnérabilités CRITIQUES (P0)            ║
║  qui permettent le contournement complet de l'authentification, le vol    ║
║  de clés de production et l'évasion de sandbox client.                    ║
║                                                                           ║
║  Aucune mise en production ne doit avoir lieu avant l'application         ║
║  et la re-certification du SPRINT 1 DE REMÉDIATION D'URGENCE.             ║
╚═══════════════════════════════════════════════════════════════════════════╝
```
