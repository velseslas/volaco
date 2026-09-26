# CARTOGRAPHIE DE LA SURFACE D'ATTAQUE (ATTACK SURFACE MAP)

**Date d'évaluation :** 11 Septembre 2026  
**Cible :** Plateforme Volaco / VibeCode Core  
**Auteurs :** Red Team Volaco  

---

## 1. Schéma Global de la Surface d'Attaque

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. COUCHE FRONTEND (apps/studio/index.html)                                           │
│    • URL : http://127.0.0.1:3000/                                                      │
│    • DOM Storage : localStorage ('vibecode_mistral_key', 'vibecode_projects_v2')       │
│    • Preview Iframe : #wsLiveIframe (sandbox: allow-scripts + allow-same-origin)        │
│    • Popout Window : window.open() avec URL.createObjectURL(blob)                     │
│    • Message Listener : window.addEventListener('message', ...)                        │
│    • Scripts CDN : tailwindcss, html2canvas, jszip, font-awesome (sans SRI)            │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ Requêtes HTTP REST
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 2. COUCHE PASSERELLE API (apps/api/src/server.ts & middleware/auth.ts)                 │
│    • 17 Fichiers de Routes / 38 Endpoints REST                                         │
│    • Port d'écoute : 3000 (défaut)                                                     │
│    • En-têtes critiques : Authorization, X-Tenant-Id, X-User-Role, Origin                │
│    • Body Parsing : readBody() plafonné à 10 Mo (MAX_BODY_BYTES = 10485760)            │
│    • CORS : Origin localhost autorisé, fallback permissif sur '*'                      │
│    • Rate Limiting : 0% implémenté                                                     │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ Appels de Fonctions TypeScript
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 3. COUCHE DOMAINE & STORES EN MÉMOIRE (packages/core/src/)                            │
│    • Identity : ProjectStore (Map<EntityId, Project>)                                  │
│    • File Explorer : FileStore (Map<tenantId, Map<path, StoredEntry>>)                 │
│    • Versioning : RevisionStore (Map<tenantId, Map<projectId, Revision[]>>)            │
│    • Settings : SettingsService (Map<string, ProjectSettings>)                         │
│    • Observability : AuditStore (Array<AuditEntry>), MetricsCollector                  │
│    • Terminal : TerminalService (Simulateur déterministe en mémoire vive)              │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ Appels Internes Runtime & IA
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 4. COUCHE INTELLIGENCE ARTIFICIELLE & AGENT RUNTIME (packages/core/src/ai-native/)     │
│    • Agent Runtime : AgentOrchestrator, PlanExecutor, ToolRegistry                     │
│    • Mutation Engine : MutationOrchestratorService (Two-Phase Commit en mémoire)       │
│    • Context Assembly : ContextAssemblyService                                         │
│    • Tool Registry : 12 outils internes manipulables par les agents                   │
│    • LLM Backend : MockLLMProvider (côté serveur Core)                                 │
│    • LLM Frontend : Mistral AI (Codestral-latest) appelé en direct depuis le browser   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Détail par Vecteur d'Exposition

### 2.1 Interface Client (Frontend Studio)
* **Entrées Utilisateur :**
  - Textarea du chat IA (`#workspaceChatInput`, `#stChatInput`).
  - Éditeur de code intégré (`updateEditorContent`).
  - Terminal interactif (`#terminalCommandInput`).
  - Champ de saisie de la clé Mistral (`#mistralApiKeyInput`).
* **Mécanismes de Stockage Client :**
  - `localStorage.getItem('vibecode_mistral_key')` : Clé API stockée en clair.
  - `localStorage.getItem('vibecode_projects_v2')` : Ensemble des projets et code source de l'utilisateur stocké sans chiffrement.
* **Canaux de Communication Asynchrones :**
  - `window.postMessage` : Réception des logs de la sandbox de prévisualisation.
  - `window.open` : Ouverture du code généré dans un nouvel onglet sans protection `rel="noopener noreferrer"`.

### 2.2 Passerelle HTTP API (`apps/api`)
* **Points d'Entrée Réseau :**
  - Serveur HTTP Node.js natif (`node:http`) sur `127.0.0.1:3000`.
* **Points d'Injection de Données :**
  - Corps de requête JSON (`POST`, `PUT`).
  - Paramètres d'URL Query String (`?path=...`, `?limit=...`, `?projectId=...`).
  - En-têtes HTTP non signés (`X-Tenant-Id`, `X-User-Role`).
* **Surfaces sans Authentification :**
  - `/metrics` : Métriques globales de requêtes du serveur.
  - `/health` et `/status` : Diagnostic et statut du serveur.
  - `/` et `/index.html` : Distribution de l'application cliente Studio.

### 2.3 Couche Domaine & Persistance RAM (`packages/core`)
* **Stockage :**
  - Aucune base de données SQL ou NoSQL externe.
  - Aucune persistance sur disque dur physique (les fichiers créés dans l'éditeur ne sont pas écrits sur le disque de l'OS hôte, mais dans la structure JavaScript `fileStore.projectFiles`).
* **Conséquence Sécurité :**
  - Un attaquant ne peut pas réaliser d'attaque par injection SQL classique.
  - En contrepartie, la mémoire vive du processus Node.js est directement exposée à la saturation (Memory Heap Exhaustion).

### 2.4 Couche Agent Runtime & Outils
* **Tool Registry (12 Outils Déclarés) :**
  - `read_file`, `list_files`, `search_code`, `get_file_tree`
  - `execute_mutation`, `rollback_transaction`
  - `build_semantic_graph`, `query_graph_nodes`
  - `analyze_impact`, `extract_dna`
  - `validate_change`, `execute_terminal`
* **Garde-fous :**
  - Les outils n'ont aucun accès aux API du système d'exploitation hôte.
  - Cependant, l'outil `execute_mutation` dispose des pleins pouvoirs pour réécrire ou supprimer n'importe quel fichier virtuel du projet.
