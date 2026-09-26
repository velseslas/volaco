# AUDIT DE QUALITÉ ET DE PERTINENCE DES TESTS (TEST_QUALITY_AUDIT)

## 1. Exhaustivité des Suites de Tests

L'ensemble des tests du monorepo totalise **1343 tests automatisés**, organisés en couches étanches :
- **FND-001 à FND-005 :** Fondations modulaires, injection de dépendances, RBAC et observabilité.
- **CORE-001 à CORE-007 :** Services de fichiers, terminal virtuel, révisions et paramètres de projet.
- **CAPP-001 à CAPP-007 :** Cycle de vie du workspace, état du projet, Studio Shell et journal d'activité.
- **AINT-001 à AINT-010 :** Couche d'ingénierie native IA, gouvernance des mutations, plans et graphe sémantique.
- **Suites de Régression de Sécurité :** `SEC-001` à `SEC-014`.
- **Suites Offensives Red Team :**
  - `offensive-audit.test.ts` : 90 vecteurs
  - `red-team-p3-live.test.ts` : 45 vecteurs
  - `red-team-p3-production.test.ts` : 51 vecteurs
  - `red-team-p4-independent.test.ts` : 23 vecteurs

## 2. Analyse de Pertinence (Anti-Tautologie)

- Les assertions ne testent pas des mocks internes isolés de l'environnement réel : elles invoquent le serveur HTTP sur un port éphémère via de véritables requêtes réseau `fetch()`.
- Les scénarios négatifs (tentatives de violation d'intégrité, tokens corrompus, traversées de chemin, plans rejetés) représentent plus de 60% des tests de sécurité, démontrant que les barrières de protection sont effectivement sollicitées et actives.
