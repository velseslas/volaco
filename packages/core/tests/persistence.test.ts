import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonFile, writeJsonFileSync } from '../src/persistence/json-disk-cache.js';

describe('PERS-001 : Persistance JSON sur disque (Unit Tests)', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'volaco-persist-test-'));

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('doit retourner la valeur par défaut si le fichier n existe pas', () => {
    const filePath = join(tmpDir, 'inexistant.json');
    const result = readJsonFile(filePath, { hello: 'default' });
    assert.deepEqual(result, { hello: 'default' });
  });

  it('doit écrire puis relire fidèlement les mêmes données', () => {
    const filePath = join(tmpDir, 'roundtrip.json');
    const data = { a: 1, b: ['x', 'y'], c: { nested: true } };
    writeJsonFileSync(filePath, data);
    const result = readJsonFile(filePath, null);
    assert.deepEqual(result, data);
  });

  it('doit revenir à la valeur par défaut si le fichier est corrompu, sans planter', () => {
    const filePath = join(tmpDir, 'corrompu.json');
    writeFileSync(filePath, '{ ceci n est pas du JSON valide', 'utf8');
    const result = readJsonFile(filePath, { fallback: true });
    assert.deepEqual(result, { fallback: true });
  });

  it('doit créer automatiquement le dossier parent si besoin', () => {
    const filePath = join(tmpDir, 'sous-dossier', 'imbrique', 'donnees.json');
    writeJsonFileSync(filePath, { ok: true });
    const raw = readFileSync(filePath, 'utf8');
    assert.deepEqual(JSON.parse(raw), { ok: true });
  });

  it('ne doit laisser aucun fichier temporaire ".tmp-*" après une écriture réussie', () => {
    const filePath = join(tmpDir, 'propre.json');
    writeJsonFileSync(filePath, { v: 1 });
    const files: string[] = readdirSync(tmpDir);
    assert.ok(!files.some((f) => f.includes('.tmp-')));
  });
});
