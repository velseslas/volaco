/**
 * MCP-TEST-ISOLATION-001 — Environnement d'isolation SQLite des suites API
 * MCP-Remote (B1/B2/B3).
 *
 * Mécanisme démontré (sondes du 2026-10-28) : les singletons `auditStore`
 * (observability/audit.ts:134, `persist: true`) et `userStore`
 * (identity/user-store.ts:95) sont construits AU CORPS DE MODULE de leur
 * module : leur premier accès SQLite (`readJsonFile` -> couche documents ->
 * `getSqliteDatabase`, persistence/sqlite-backend.ts:36-57) LIE le chemin
 * `VOLACO_DATA_DIR || cwd/.volaco-data` DÈS L'ÉVALUATION du module importé.
 * Or l'ESM évalue les imports statiques d'un fichier AVANT son propre corps :
 * une affectation `process.env.VOLACO_DATA_DIR = ...` placée après les
 * imports (ancien patron des suites) arrivait trop tard et les fixtures de
 * test partaient dans la base du dépôt (`Y:\.volaco-data`).
 *
 * REMÈDE : ce module, SANS DÉPENDANCE PROJET, est importé EN PREMIER dans
 * chaque suite concernée. ESM évalue la grappe d'imports dans l'ordre de
 * déclaration : son corps (mkdtemp + affectation env) s'exécute donc AVANT
 * toute évaluation des modules projet (routes, user-store…). Le répertoire
 * est neuf, sous `os.tmpdir()`, hors dépôt, jamais réutilisé ; le `rmSync`
 * final de chaque suite (inchangé) reste responsable du nettoyage.
 *
 * CONTRAINTE : isolation par défaut de `node --test` — un fichier de test
 * par sous-processus, donc un répertoire mkdtemp distinct par suite.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ISOLATED_DATA_DIR = mkdtempSync(join(tmpdir(), 'volaco-api-mcp-remote-iso-'));
process.env.VOLACO_DATA_DIR = ISOLATED_DATA_DIR;

export const isolatedVolacoDataDir = ISOLATED_DATA_DIR;
