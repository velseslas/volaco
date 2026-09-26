/**
 * VibeCode Core — Backend SQLite (ÉTAPE 3 : persistance durable)
 *
 * Remplace le stockage fichiers JSON par une base SQLite intégrée (node:sqlite,
 * présent dans Node >= 22.5 — aucune dépendance native à compiler). Toutes les
 * écritures des stores passent par `json-disk-cache.ts`, qui route ici : c'est
 * donc la SEULE brique à modifier pour migrer toute la persistance.
 *
 * Caractéristiques :
 * - un seul fichier `.volaco-data/volaco.db` (WAL, synchronous=NORMAL) ;
 * - table document `documents(key, content)` : chaque store sérialise déjà en
 *   JSON, on conserve ce modèle document (le schéma relationnel fin de l'annexe
 *   B du CDC viendra avec PostgreSQL, quand le scale le justifiera) ;
 * - si node:sqlite est indisponible dans le runtime, `isSqliteAvailable()`
 *   renvoie false et `json-disk-cache.ts` retombe proprement sur les fichiers
 *   (comportement hérité, non cassant) ;
 * - migration transparente : au premier accès, un document absent de la base
 *   mais présent en fichier JSON hérité est importé automatiquement.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { logger } from '../logger.js';

let dbInstance: DatabaseSync | null = null;
let initFailed = false;

function dataDir(): string {
  return process.env.VOLACO_DATA_DIR || join(process.cwd(), '.volaco-data');
}

function dbPath(): string {
  return join(dataDir(), 'volaco.db');
}

export function getSqliteDatabase(): DatabaseSync | null {
  if (dbInstance) return dbInstance;
  if (initFailed) return null;
  try {
    if (!existsSync(dataDir())) mkdirSync(dataDir(), { recursive: true });
    const db = new DatabaseSync(dbPath());
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec(
      'CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\')))'
    );
    dbInstance = db;
    return db;
  } catch (error) {
    initFailed = true;
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`SQLite indisponible, repli sur la persistance fichiers JSON : ${message}`, {
      component: 'sqlite-backend'
    });
    return null;
  }
}

export function isSqliteAvailable(): boolean {
  return getSqliteDatabase() !== null;
}

/** Clé de document dérivée du chemin historique (ex: .../projects.json -> "projects"). */
export function documentKeyFromPath(filePath: string): string {
  return basename(filePath).replace(/\.json$/, '');
}

export function readDocument(key: string): string | null {
  const db = getSqliteDatabase();
  if (!db) return null;
  const row = db.prepare('SELECT content FROM documents WHERE key = ?').get(key) as
    | { content: string }
    | undefined;
  return row ? row.content : null;
}

export function writeDocument(key: string, content: string): boolean {
  const db = getSqliteDatabase();
  if (!db) return false;
  db.prepare(
    "INSERT INTO documents (key, content, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at"
  ).run(key, content);
  return true;
}

export function sqliteDatabasePath(): string {
  return dbPath();
}
