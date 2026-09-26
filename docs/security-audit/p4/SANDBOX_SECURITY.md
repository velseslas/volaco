# AUDIT DE LA SANDBOX ET DU TERMINAL VIRTUEL (SANDBOX_SECURITY)

## 1. Absence Totale d'Exécution Système (`child_process`)

Une inspection statique et dynamique de l'ensemble du monorepo `volaco-core` a été conduite pour détecter tout appel aux mécanismes d'exécution système du système hôte :
- Aucune occurrence de `child_process.exec`, `child_process.spawn`, `child_process.fork` ou `child_process.execFile` n'existe dans le code applicatif.
- Les seules références proviennent des définitions de types Node.js (`@types/node`).

## 2. Émulateur de Terminal Virtuel

Le service de terminal (`packages/core/src/terminal/service.ts`) utilise une whitelist stricte (`packages/core/src/terminal/whitelist.ts`) :
- Seules les commandes `git`, `npm`, `node` (et leurs sous-commandes autorisées comme `status`, `log`, `test`, `build`) sont reconnues.
- Les commandes sont traitées par un émulateur pur renvoyant des réponses synthétiques déterministes.
- Toute tentative d'injection de commandes shell (`&&`, `;`, `|`, `>`, backticks) est interceptée et rejetée.

## 3. Confinement du Système de Fichiers

Les opérations de lecture/écriture de fichiers sont encapsulées dans `DurableFileRepository`. Toute tentative de traversée de chemin (`../`, `..\`, encodages URL `%2e%2e`) est neutralisée, maintenant les opérations dans le bac à sable du projet.
