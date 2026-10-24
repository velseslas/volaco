# PLAN V8 — CDC V7.0 × AUDITS × MESURES × LANCEMENT

**Date :** 13 octobre 2026 · **Projet :** volaco-core / VIBE CODING PLATFORM
**Sources fusionnées :** `Volaco_CDC_V7_V8.1_Unified_Final` (cahier des charges V7.0, 63 sections + annexes A–L) · `AUDIT-BACKEND-SECURITE-20261012.md` · `AUDIT-PREVIEW-20261012.md` · `AUDIT-CONVERSATION-20261013.md` · `BENCH-RESULTATS-MESURES-20261013.md` · `ARCHITECTURE-QUI-ENCAISSE-20261013.md` · `PLAN-LANCEMENT-50K-20261013.md` · `deploy/`

**Ce que ce document est :** le plan d'exécution unique. Chaque travail porte **sa justification CDC (§)**, **son constat d'audit** (SEC/PV/CV) ou **sa mesure**, son **effort**, et son **critère de vérification**.
**Ce qu'il n'est pas :** il ne remplace pas les audits (preuves détaillées) ni le guide de déploiement.

---

## 1. Les 5 vérités du CDC qui commandent tout le reste

Le cahier des charges contient lui-même les règles qui arbitrent les débats des derniers jours. Je les cite pour qu'elles soient incontestables :

| # | Ce que dit le CDC | Conséquence directe |
|---|---|---|
| 1 | **« SCALE WHEN REQUIRED, NOT BECAUSE POSSIBLE »** — §3.10, répété en §62 et en conclusion | On ne construit pas l'infrastructure hyperscale à l'avance. Le débat « 100 000 maintenant ou plus tard » est **tranché par ton propre document**. |
| 2 | §47 : les cibles (100 000 utilisateurs simultanés, 100 000 req/s, 99,99 %, p99 < 1 s, RPO ≤ 1 min) sont **« des objectifs de maturité et non des exigences du lancement »** | Le lancement se juge sur d'autres critères : fiabilité, absence de faille, expérience. |
| 3 | §57 : **« Le budget d'infrastructure hyperscale ne doit pas être appliqué au lancement »** (scénario de maturité ≈ 1 à 1,85 M€/mois) | Aucune décision de coût ne se prend sur le scénario de maturité. |
| 4 | §62 — ordre d'introduction imposé : **PostgreSQL dès le départ · AI Gateway dès le départ · Sandbox dès le départ · Application Model dès le départ** ; Redis dès que nécessaire ; Kafka / Kubernetes / sharding / GPU / multi-région **seulement quand les métriques le justifient** | Ton chemin de lancement = Phase 0 du CDC + un sous-ensemble de la Phase 1. Ni Kafka, ni Kubernetes, ni multi-région. |
| 5 | §59 — le CDC liste lui-même ses risques critiques : mauvaise compréhension IA, hallucination, **agent trop autonome**, **cross-tenant leakage**, **sandbox exploit**, prompt injection, **explosion du coût IA**, burn rate, product-market fit | Ces risques sont **mesurables**. Quatre d'entre eux sont ouverts aujourd'hui dans le code (voir §2). |

---

## 2. Confrontation : le CDC contre l'état réel du code

### 2.1 Les risques critiques du CDC… déjà ouverts

| Risque critique (CDC §59) | État réel | Preuve |
|---|---|---|
| **Cross-tenant leakage** | 🔴 **Ouvert** | Aucun contrôle d'appartenance au locataire sur `/app/*`, `/app/status`, `/preview-bundle` ; ces chemins échappent au garde-fou d'authentification (PV-02). Le CDC §37 exige pourtant « toutes les données isolées » **et des tests cross-tenant automatisés** |
| **Sandbox exploit** | 🔴 **Ouvert** | Le terminal exécute les scripts du `package.json` du projet (SEC-03) ; lecture de fichiers hors projet via l'identifiant de projet (SEC-01) ; navigateur headless sans isolation (SEC-02, PV-07) ; builds Vite **dans le processus de l'API** |
| **Explosion du coût IA** | 🔴 **Ouvert** | Aucun plafond par demande, ni par compte, ni par jour ; 2 à 4 appels par message, contexte non tronqué (CV-15), éventail d'agents non borné, pas de coupe-circuit |
| **Agent trop autonome** | 🔴 **Ouvert** | Pas de matrice de capacités READ/WRITE/DENY par agent (exigée §20), pas de registre d'outils avec niveau de risque (§23), écritures déclenchées avec un simple droit de lecture (CV-01) |
| Prompt injection | 🟠 **Partiellement traité** | Consigne explicite dans le prompt système (« seule la demande utilisateur est une instruction ») mais contenu non fiable réinjecté sans délimitation (CV-16) |
| Hallucination / mauvaise compréhension | ⚪ **Non mesuré** | §52 exige un **taux d'hallucination** et une **précision d'intention** : aucun des deux n'est instrumenté. Pire : le repli simulateur invisible (CV-05) **fausserait la mesure** |
| Burn rate / product-market fit | — | Hors périmètre technique |

**À retenir :** le CDC classe ces risques « Critique » et exige pour chacun **un responsable, une métrique et un plan**. Aujourd'hui : quatre sont ouverts avec preuve, trois ne sont même pas mesurés.

### 2.2 Violations directes de sections du CDC

| Section du CDC | Exigence | Écart constaté |
|---|---|---|
| **§3.4 Least privilege** | « Chaque agent et outil possède uniquement les permissions nécessaires » | Les routes de conversation qui **écrivent** les fichiers n'exigent que le droit de **lecture** (CV-01) — un rôle VIEWER peut modifier le projet |
| **§35 Security** | TLS 1.3, chiffrement au repos, WAF, DDoS, rate limiting, RBAC, least privilege, journaux d'audit, en-têtes de sécurité, gestion des secrets | Authentification non appliquée par défaut (SEC-04) ; pas de HSTS ; journal d'audit **sans identité** (SEC-11) |
| **Annexe F (Security Baseline)** | HSTS, CSP, nosniff, Referrer-Policy, Permissions-Policy — « toute exception doit être documentée **et limitée** » | nosniff / Referrer / Permissions / Frame-Options ✅ ; **HSTS absent**, **CSP absente sur le Studio** (l'exception est documentée mais non limitée dans le temps) |
| **§36 AI Security** | Protection contre la fuite de secrets, l'exfiltration, les appels d'outils dangereux | Indice de clé IA dans les erreurs **et persisté sur disque** (SEC-07/CV-07) ; contenu généré exécutable sur l'origine du Studio (PV-01) |
| **§37 Multi-Tenancy** | Shared PostgreSQL + tenant_id + RLS ; isolation totale ; **tests cross-tenant automatisés** | PostgreSQL absent ; isolation non vérifiée sur les routes récentes ; aucun test cross-tenant sur ces routes |
| **§19 AI Orchestrator** | L'orchestrateur gère **budgets, timeouts, retries** | Aucun budget agrégé par demande, aucun retry sur les appels modèle (CV-17) |
| **§41 + Annexe I** | Arrêt propre : SIGTERM → stop → drain → fermeture → terminaison (cible 30 s) | Aucun gestionnaire d'arrêt ; les exécutions en cours restent « en cours » après redémarrage (ADD-03) |
| **§44 + Annexe H** | Version, auth, pagination, erreurs, **rate limits exposés** (X-RateLimit-*), **idempotence**, dépréciation | Pas d'OpenAPI, pas d'en-têtes X-RateLimit-*, pas d'idempotence, listes non paginées, trois formats d'erreur différents |
| **§46** | Sauvegardes **et restauration vérifiée**, test de restauration mensuel | Sauvegardes non automatisées ; restauration jamais testée ; un document corrompu **efface silencieusement** les données (ADD-02) |
| **§42** | Crédits : RESERVE → EXECUTE → CONFIRM/RELEASE ; **PostgreSQL source de vérité financière** | Aucun système de crédits ; le suivi d'usage est un fichier JSON (et il n'est pas transactionnel) |
| **§50 / §51** | Rétention, suppression, anonymisation, portabilité ; **zéro entraînement sur les données client** | Rien n'est purgé (audit, usage, traces, sessions) ; politique fournisseurs non formalisée |

---

## 3. L'écart d'échelle (à regarder en face)

| | CDC (cible de maturité) | Réalité d'aujourd'hui |
|---|---|---|
| Équipe | **≈ 18 personnes** (§56 : 1 CTO, 2 AI/LLM, 3 backend, 3 frontend, 2 full-stack, 2 DevOps/SRE, 2 QA, 1 sécurité, 1 PM, 1 design) | **1 fondateur** (profil no-code) |
| Budget mensuel | **≈ 1 à 1,85 M€** (§57) | quelques centaines d'euros |
| Délai | Phases 0 à 5 sur ~15 mois puis scale (§55) | lancement visé en semaines |

**Conclusion, sans détour :** le CDC est une **cible d'entreprise**, pas un plan de lancement. Ta force, c'est que les différenciateurs du CDC sont **déjà écrits** (voir §7) : le travail restant n'est pas d'inventer le produit, c'est de **le rendre sûr, honnête, mesurable et soutenable** — ce que fait ce plan.

---

## 4. Le plan V8 — 8 lots

**Rappel des repères mesurés :** 1 200-1 700 req/s par instance · **100 écritures/s** · 3 générations en parallèle · gel des autres clients sous charge (sonde de 18 ms à 485 ms).

### LOT 0 — Fermer l'exposition · ~3 jours
CDC §35, §36, §3.4 · Constats SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07, PV-01, PV-02, CV-01, ADD-01

| Travail | Justification | Effort |
|---|---|---|
| 1. Authentification obligatoire par défaut | CDC §35 (RBAC) · SEC-04 | S |
| 2. Retirer l'exécution de scripts de projet du terminal | CDC §59 (sandbox exploit) · SEC-03 | S |
| 3. Valider l'identifiant de projet avant tout appel MCP | CDC §36 (isolation) · SEC-01 | S |
| 4. Contrôle d'appartenance au locataire sur `/app/*` et `/preview-bundle` + extension du garde-fou d'authentification | CDC §37 · PV-02 | M |
| 5. Sortir le contenu généré de l'origine du Studio + retirer la clé IA du navigateur | CDC §36 (isolation) · PV-01 | M |
| 6. Contrôle d'origine + type JSON obligatoire sur les méthodes mutantes | CDC §35 · SEC-05 | S |
| 7. Navigateur headless : hôtes autorisés + sandbox réactivé | CDC §24, §59 · SEC-02, PV-07 | M |
| 8. URL de rendu construite côté serveur (jamais depuis l'en-tête client) | SEC-06 | S |
| 9. Adresse réelle du visiteur derrière l'accueil/Cloudflare | `PATCH-IP-REELLE.md` | S |
| 10. Retirer l'indice de clé des erreurs **et du disque** | CDC §36 (fuite de secrets) · SEC-07, CV-07 | S |
| 11. Droit d'écriture exigé sur les routes de conversation mutantes | **CDC §3.4** · CV-01 | S |
| 12. Régénérer la clé Mistral + nettoyer les copies anciennes du dépôt | CDC §35 (gestion des secrets) | S |

**Critère d'acceptation :** sans jeton, tout `/api` répond 401 ; un rôle lecteur ne peut plus écrire ; aucun scan ne trouve de secret ; deux appareils simultanés ne se bloquent pas ; `npm test` refusé par le terminal.

### LOT 1 — Honnêteté et protection des données · ~1 semaine
CDC §41, §46, §42, §50, §19 · Constats ADD-02…ADD-08, CV-02…CV-06

13. Refus de démarrer si un document est illisible + copie de sécurité avant écriture + stockage actif affiché dans `/health` — *CDC §46 (aucune perte silencieuse)* · S
14. **Arrêt propre selon la séquence du CDC (Annexe I : SIGTERM → drain 30 s → fermeture)** + marquage des exécutions interrompues au démarrage — *CDC §41 + Annexe I* · M
15. Cesser d'avaler les erreurs fatales (le superviseur relance) · S
16. Idempotence des actions mutantes + contrôle d'empreinte sur les écritures — *CDC Annexe H* · M
17. `/execute` : budget de temps réaliste + révision après écriture — *CDC §32* · S
18. Plafond de tours appliqué au chemin réel + troncature des messages conservés · S
19. Annulation qui coupe réellement l'appel au modèle ; coût « inconnu » ≠ 0 — *CDC §20 (« ⏹ et non ❌ »)* · S
20. Marquer visiblement le repli simulateur — *CDC §52 (sinon le taux d'hallucination est faussé)* · S
21. Messages d'erreur utilisateur normalisés — *CDC §39* · S
22. **Plafond de dépense par demande, par compte et par jour** — *CDC §19 (budgets), §53 (alertes coût anormal)* · M
23. Rétention et rotation (audit, usage, traces, sessions) — *CDC §50* · S
24. Rotation des journaux · S

**Critère :** redémarrer en pleine génération ne laisse aucune exécution fantôme ; un document corrompu **empêche** le démarrage ; un double-clic ne double pas la facture ; une écriture concurrente est refusée (409) au lieu d'être perdue.

### LOT 2 — Les gains mesurés · ~1 semaine
Mesures du 12/10 · CDC §47 (p50/p99), §40 (protection)

25. Journalisation non bloquante (1 écriture disque synchrone par requête aujourd'hui) · S
26. Hachage asynchrone (le gel des autres clients : 485 ms → ~30 ms) · S
27. Cache + compression des fichiers statiques (mur de 550 req/s) · S
28. Mesure interne de l'engorgement + histogramme par route — *CDC §45 (SLI)* · S
29. Limitation **par route** + journal des refus — *CDC §35* · M
30. Commandes externes asynchrones + plafond de temps serveur · M

**Critère :** rejouer le banc → p95 de la sonde < 50 ms sous charge d'écriture/connexion ; débit statique > 1 500 req/s.

### LOT 3 — Persistance transactionnelle · 2 à 4 semaines
**CDC §38 + §62 : « PostgreSQL → dès le départ »**, §37 (tenant_id + RLS), §42 (source de vérité financière)

31. PostgreSQL + migration des documents actuels (users, projects, files, revisions, audit, usage, conversations, executions) · L
32. Migrations versionnées + sauvegarde automatique + **restauration testée** — *CDC §46* · M
33. Plafonds du VFS, resynchronisation disque, lecture sans effet de bord · M
34. **tenant_id sur chaque ressource + RLS + tests cross-tenant automatisés** — *CDC §37* · M
35. Identité utilisateur dans le contexte + audit nominatif — *CDC §3.5, §35* · S
36. Jetons courts + révocation · M

**Critère :** 5 000 projets sans dégradation ; ≥ 1 000 écritures/s ; un test cross-tenant automatique échoue si l'isolation casse ; l'audit nomme une personne.

### LOT 4 — Découplage, files, agents · 3 à 6 semaines
**CDC §19 (orchestrateur : budgets, timeouts, retries), §39 (outbox/DLQ), §41, §42, §24 (sandbox dès le départ)**

37. File d'attente (Redis) + 3 files (action rapide / génération / déploiement) + limite par fournisseur · L — *CDC §62 : « Redis dès que nécessaire »*
38. Travaux détachables (identifiant + position + reprise) — *CDC §17, §41 (replay)* · M
39. API sans état + compteurs partagés + plusieurs instances · M
40. Build atomique (répertoire versionné + bascule) · S
41. **Budget agentique par demande** (compteur partagé, arrêt propre) + **plafond d'agents** — *CDC §19* · S
42. **Équité par compte dans la file** + **mode dégradé automatique** (1 agent sous charge) · M
43. Agents exécutés **hors du processus web** (ouvriers) · L
44. **Matrice de capacités READ/WRITE/DENY par agent** — *CDC §3.4 + §20* · M
45. **Registre d'outils** (permissions, délai, coût, niveau de risque) — *CDC §23* · M
46. **Sandbox d'exécution par conteneur** (CPU, mémoire, temps, réseau coupé par défaut) — *CDC §24 + §62* · L
47. Coupe-circuit + réessais + file de rebut sur les appels externes — *CDC §39, §40* · M

**Critère :** 3 instances tournent ; une génération lourde ne change pas la latence des lectures ; 300 demandes simultanées passent en file sans perte ; le mode dégradé s'active et se désactive automatiquement ; un agent ne peut pas écrire hors de sa matrice.

### LOT 5 — Contrat, qualité, outillage · ~1 semaine
CDC §44 + Annexe H, §52, §53

48. Intégration continue (types, tests, dépendances, secrets) · S
49. Test de charge automatique avec seuils · S
50. **OpenAPI 3.1** + tests de contrat des événements — *CDC §44* · M
51. **Format d'erreur unique + catalogue de codes** — *CDC Annexe H* · S
52. **Pagination par curseur** — *CDC §44* · M
53. **En-têtes X-RateLimit-* / Retry-After** — *CDC §44* · S
54. Tests aléatoires des analyseurs (chemins, sections, événements) · M
55. Script de vérification « fumée » (10 chemins critiques) · S
56. **Métriques IA à instrumenter : précision d'intention, succès des plans, succès des outils, succès des réparations, taux d'hallucination, coût par résultat réussi** — *CDC §52, §53* · M
57. Modèle par agent + allègement du contexte · M

**Critère :** un envoi qui casse un test ne passe pas ; une baisse de performance ne passe pas ; le contrat est écrit ; le tableau de bord IA existe.

### LOT 6 — Préparer l'ouverture · 2 à 3 semaines
CDC §42, §43, §50, §51, §49

58. Mode « prudence » par réglage (couper génération/terminal/MCP sans redéployer) · S
59. **Crédits : RESERVE → EXECUTE → CONFIRM/RELEASE**, PostgreSQL source de vérité — *CDC §42* · M
60. Invitations/membres par projet **ou** décision assumée « un compte = un monde » · M
61. Réinitialisation de mot de passe — *indispensable à 50 000 comptes* · M
62. Export/portabilité d'un projet — *CDC §50* · M
63. **Rétention, suppression, anonymisation** + politique de confidentialité et sous-traitants — *CDC §50, §51* · M
64. **Politique fournisseurs : zéro entraînement sur les données client, DPA, clé par locataire** — *CDC §51, §36* · S
65. Facturation et paiement local (voir §6 — décision à prendre) · L

### LOT 7 — Environnement d'exécution et déploiement utilisateur · 1 à 2 mois
CDC §24, §33, §34, §32, §49 · (chantier séparé, condition d'ouverture aux inconnus)

66. Accueil dédié au contenu généré (origine séparée, en-têtes stricts, réseau contrôlé) · L
67. Contrat universel d'exécution (généraliser le socle existant) · M
68. Serveur de développement + mise à jour à chaud · L
69. Déploiement utilisateur (preview / staging / production, domaines, HTTPS, historique, retour arrière) — *CDC §33* · L
70. Intelligence de production (surveillance des applications déployées) — *CDC §34* · L
71. Collaboration temps réel (présence, curseurs, CRDT) — *CDC §32* · L
72. Internationalisation (arabe + RTL en premier) et accessibilité — *CDC §49* · L

---

## 5. Ce que le CDC impose et qui n'était pas dans mon plan

**Treize travaux que je n'avais pas identifiés avant de lire le CDC** — c'est le gain le plus concret de ce document :

| # | Travail | Section CDC | Pourquoi je ne l'avais pas vu |
|---|---|---|---|
| A | **Sandbox dès le départ** (conteneurs, réseau coupé) | §24 + §62 | Je l'avais placé « plus tard, pour des inconnus » ; le CDC l'exige **à la fondation** |
| B | **Matrice de capacités par agent** (READ/WRITE/DENY) | §3.4 + §20 | Je traitais la sécurité par route ; le CDC l'exige **par agent** |
| C | **Registre d'outils** avec coût et niveau de risque | §23 | Leur chaîne d'outils existe, mais sans registre déclaratif |
| D | **En-têtes de limitation exposés** (X-RateLimit-*) | §44 + Annexe H | Je n'avais relevé que l'absence de journalisation des refus |
| E | **HSTS + CSP** (Studio **et** preview, exceptions documentées **et limitées**) | §35 + Annexe F | J'avais noté l'absence de CSP, pas l'absence de HSTS ni l'exigence de « limite » |
| F | **Séquence d'arrêt propre de 30 s** | §41 + Annexe I | J'avais « arrêt propre », sans la séquence exigée |
| G | **Pattern RESERVE → EXECUTE → CONFIRM** des crédits | §42 | Je proposais un simple décrément ; le CDC impose une réservation |
| H | **Coupe-circuit, file de rebut, idempotence** sur les appels externes | §39 + §40 | J'avais les réessais, pas le coupe-circuit ni la DLQ |
| I | **Object storage** pour les artefacts | §38 | Je m'en tenais au disque du VPS |
| J | **Métriques IA** (hallucination, précision d'intention, coût par résultat) | §52 + §53 | J'avais « coût par utilisateur », pas la qualité IA mesurée |
| K | **Zéro entraînement sur les données client** + politique fournisseurs | §51 | Contrainte que j'avais complètement omise |
| L | **Rétention/suppression/anonymisation/portabilité** | §50 + Annexe J | J'avais la rétention technique, pas les obligations utilisateur |
| M | **Tests cross-tenant automatisés** | §37 | Je les proposais pour les routes nouvelles, le CDC en fait une exigence générale |

---

## 6. LA tension à trancher (c'est la seule vraie contradiction)

**Le CDC place la facturation en Phase 4 — c'est-à-dire à 12-15 mois (§55).**
**Ton lancement veut 50 000 comptes avec crédits et paiement en dinars — dans quelques semaines.**

Trois options, avec ma recommandation :

| Option | Ce que ça implique | Mon avis |
|---|---|---|
| **A. Lancement sans paiement** : crédits gratuits seulement, un bouton « je veux passer payant » qui **mesure la demande**, et un **pilote de bons prépayés limité** (200 codes vendus par des revendeurs) | Aucun chantier de passerelle, aucun encaissement, mais tu mesures la disposition à payer | ✅ **recommandé** : le lancement sert à mesurer, pas à encaisser |
| B. Passerelle de paiement locale dès le lancement | +2 à 3 semaines (commande, webhook, facture, remboursement, rapprochement) et dépendance à un prestataire | 🟠 seulement si tu as déjà un partenaire prêt |
| C. Crédits payants sans passerelle (virement/bons) | Manual, non scalable, mais zéro développement | 🟠 acceptable en pilote |

**Conséquence calendrier :** en option A, le chemin de lancement reste à **7-10 semaines** (au lieu de 12-14 avec la passerelle).

---

## 7. Ce que le CDC valide dans l'existant (à ne pas casser)

Point encourageant, et c'est important pour la suite : **les différenciateurs du CDC sont déjà écrits dans ton dépôt.**

| Différenciateur (CDC §) | État dans le code |
|---|---|
| Conversation Intelligence (§9-11) | `conversation-intelligence/**` : intention, boussole, hypothèses, clarifications, plans |
| Application Model / DNA / Memory (§12-14) | `dna/**`, `application-understanding/**`, mémoire projet |
| Decision Intelligence + Assumption Engine (§15-16) | `decision-engine/**`, `decision-ledger`, `assumption-engine.ts` |
| Plan Engine + Impact Intelligence (§17-18) | `conversation-intelligence/engine/plan-generator.ts`, `impact-intelligence/**` |
| AI Orchestrator + Agents (§19-20) | `ai-orchestrator/**` (7 agents spécialisés, ordonnanceur, détecteur de conflits) |
| Generation Core + Tools (§21-23) | `tool-loop.ts`, `app-pipeline.ts` (build réel) |
| Validation + Self-Repair (§25-26) | `repair.ts` (boucle bornée, Pareto-Safe), `agent-runtime/execution/verification.ts` |
| Visual Intelligence + Design Harmony (§27-28) | `visual-intelligence/**`, `design-harmony/**` (score détaillé, drift) |
| Application Audit (§29) | `application-audit/auditors/**` : les **8 audits** du CDC sont présents |
| Feature Intelligence + DNA Evolution (§30-31) | `feature-intelligence/**`, `evolution/**` |
| Provider Independence (§3.8) | registre multi-fournisseurs (Mistral, Gemini) — **atout majeur** dans un contexte de paiement contraint |

**La conclusion est nette :** le produit est là ; **l'ingénierie de service** (persistance, files, sandbox, isolation, facturation, observabilité) est ce qui manque. C'est précisément le contenu des lots 0 à 6.

---

## 8. Ce qui reste volontairement hors périmètre (et pourquoi)

Conformément au principe directeur du CDC (§3.10, §62), ces sujets sont **explicitement différés** — et le CDC lui-même donne le critère de déclenchement :

| Sujet | Critère de déclenchement (CDC) |
|---|---|
| Kafka / bus d'événements complet | « lorsque le volume ou le découplage le justifie » (§39, §62) |
| Kubernetes | « lorsque le scale le justifie » (§62) — Annexes G quand le moment viendra |
| Sharding | « lorsque PostgreSQL atteint ses limites » (§62) |
| GPU / modèles propriétaires | « lorsque les economics le justifient » (§62, §48) |
| Multi-région / active-active | « lorsque SLA et volume le justifient » (§62) |
| Marketplace, SDK Go/Python, CLI | Phase 4-5 (§44, §55) |
| Collaboration temps réel (CRDT) | Phase 1-2 produit (§32) — aucune urgence au lancement |
| 100 000 connexions WebSocket | objectif de maturité (§41, §47) |
| SSO/SAML, SOC 2, ISO 27001 | Phase 4 (§50, §55) — mais la **rétention** et la **politique fournisseurs** se préparent maintenant (lot 6) |

---

## 9. Calendrier de lancement (50 000 comptes, crédits limités)

| Étape | Durée | Contenu |
|---|---|---|
| Semaine 1 | Lot 0 | Fermer l'exposition — **condition d'existence**, pas une option |
| Semaine 2 | Lot 1 | Honnêteté : arrêt propre, budgets, crédits minimaux, aucune perte silencieuse |
| Semaine 3 | Lot 2 | Gains mesurés : suppression du gel, cache, métriques |
| Semaines 4-6 | Lot 3 | PostgreSQL, RLS, tests cross-tenant, sauvegardes testées |
| Semaines 5-7 | Lot 4 (cœur) | File d'attente, équité par compte, mode dégradé, budget agentique, sandbox conteneur |
| Semaine 7 | Lot 5 (essentiel) | CI, test de charge aux paliers de lancement, erreurs uniques |
| Semaine 8 | Lot 6 (essentiel) | Crédits (réservation), mot de passe, mode prudence, supervision et alertes |
| **Semaine 8** | — | **Test de charge final : 300 générations simultanées + mode dégradé + file** |
| Semaine 9 | — | Ouverture par vagues : 500 → 5 000 → 50 000 |

**Budget de la vague (rappel) :** 1 000 à 4 500 € de coût IA selon la taille du crédit gratuit (20 crédits recommandés, expirant en 30 jours) + 200-400 €/mois d'infrastructure.

---

## 10. Honnêteté sur ce document

1. **Aucun de ces travaux n'est exécuté** : je n'ai pas d'exécution dans cette session — pas de compilation, pas de test, pas de déploiement. Chaque travail porte donc son **critère de vérification** : c'est ce qui remplace ma signature.
2. **Les efforts sont des ordres de grandeur** pour un développeur qui connaît le projet.
3. **Les correspondances CDC → constats** sont établies par lecture directe du CDC et du code ; elles sont citables section par section.
4. **Deux points du CDC ne sont pas traités ici** : l'organisation/équipe (§56, ≈18 personnes) et le budget de maturité (§57) — ce sont des décisions de financement, pas d'ingénierie. Le présent plan est dimensionné pour **un développeur**, pas pour dix-huit.
5. **La priorité absolue reste le lot 0**, quelle que soit la suite : un lancement médiatisé avec les failles actuelles ouvertes transformerait la première vague en incident public — et le CDC classe ces risques « Critique ».
