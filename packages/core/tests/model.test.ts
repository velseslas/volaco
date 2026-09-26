import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  RevisionStore,
  computeSha256,
  createFileArtifact
} from '../src/index.js';

describe('FND-004 : Application Model V0 Unit Tests', () => {
  let store: RevisionStore;

  beforeEach(() => {
    store = new RevisionStore();
  });

  it('doit calculer un condensat SHA-256 valide et dÃ©terministe pour les fichiers', () => {
    const content = '<!DOCTYPE html><html><body><h1>VibeCode</h1></body></html>';
    const hash1 = computeSha256(content);
    const hash2 = computeSha256(content);
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64); // SHA-256 = 64 caractÃ¨res hexadÃ©cimaux

    const artifact = createFileArtifact('index.html', content, 'text/html');
    assert.equal(artifact.path, 'index.html');
    assert.equal(artifact.size, Buffer.byteLength(content, 'utf8'));
    assert.equal(artifact.hash, hash1);
    assert.equal(artifact.mimeType, 'text/html');
  });

  it('doit incrÃ©menter sÃ©quentiellement le numÃ©ro de rÃ©vision et chaÃ®ner les parents', () => {
    const rev1 = store.createRevision('tenant_1', 'proj_1', {
      message: 'Initial commit',
      author: 'dev1',
      files: { 'index.html': '<h1>Version 1</h1>' },
      provenance: { source: 'USER', prompt: 'CrÃ©e une page' }
    });

    assert.equal(rev1.revisionNumber, 1);
    assert.equal(rev1.parentRevisionId, undefined);

    const rev2 = store.createRevision('tenant_1', 'proj_1', {
      message: 'Mise Ã  jour titre',
      author: 'dev1',
      files: { 'index.html': '<h1>Version 2</h1>' },
      provenance: { source: 'AI_AGENT', prompt: 'Change le titre' }
    });

    assert.equal(rev2.revisionNumber, 2);
    assert.equal(rev2.parentRevisionId, rev1.id);
  });

  it('doit exÃ©cuter un rollback sans dÃ©truire l historique et enregistrer la provenance', () => {
    const rev1 = store.createRevision('tenant_1', 'proj_1', {
      message: 'Version Stable',
      author: 'lead',
      files: { 'app.js': 'console.log("stable");' },
      provenance: { source: 'USER' }
    });

    store.createRevision('tenant_1', 'proj_1', {
      message: 'Version CassÃ©e',
      author: 'dev2',
      files: { 'app.js': 'console.log("broken"); throw new Error();' },
      provenance: { source: 'USER' }
    });

    // Rollback vers rev1
    const rev3 = store.rollbackTo('tenant_1', 'proj_1', rev1.id, 'lead', 'req_rollback_123');

    assert.equal(rev3.revisionNumber, 3);
    assert.equal(rev3.files['app.js']?.content, 'console.log("stable");');
    assert.equal(rev3.provenance.source, 'SYSTEM_REPAIR');
    assert.equal(rev3.provenance.triggerRequestId, 'req_rollback_123');
    assert.equal(rev3.decisions.length, 1);
    assert.equal(rev3.decisions[0]?.title, 'Rollback Technique');

    // L'historique total contient bien les 3 rÃ©visions
    const history = store.listRevisions('tenant_1', 'proj_1');
    assert.equal(history.length, 3);
  });
});
