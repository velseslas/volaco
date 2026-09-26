import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, StructuredLogger, generateRequestId, AppError, NotFoundError, ValidationError } from '../src/index.js';

describe('FND-002 : Core Subsystem Unit Tests', () => {
  it('doit charger une configuration typÃ©e avec des valeurs par dÃ©faut saines', () => {
    const config = loadConfig();
    assert.equal(config.appName, 'VibeCode Studio Core');
    assert.equal(config.version, '0.1.0');
    assert.equal(config.apiPrefix, '/api/v1');
    assert.equal(typeof config.port, 'number');
  });

  it('doit permettre de surcharger la configuration proprement', () => {
    const custom = loadConfig({ port: 8080, env: 'production' });
    assert.equal(custom.port, 8080);
    assert.equal(custom.env, 'production');
  });

  it('doit gÃ©nÃ©rer un Request ID prÃ©fixÃ© et non vide', () => {
    const reqId = generateRequestId();
    assert.ok(reqId.startsWith('req_'));
    assert.ok(reqId.length > 10);
  });

  it('doit structurer les entrÃ©es de log JSON avec horodatage et contexte', () => {
    const log = new StructuredLogger({ app: 'test-runner' });
    const entry = log.createEntry('info', 'Message de test', { action: 'bootstrap' }, 'req_12345');
    assert.equal(entry.level, 'info');
    assert.equal(entry.message, 'Message de test');
    assert.equal(entry.requestId, 'req_12345');
    assert.equal(entry.context?.['app'], 'test-runner');
    assert.equal(entry.context?.['action'], 'bootstrap');
    assert.ok(entry.timestamp);
  });

  it('doit sÃ©rialiser correctement les erreurs typÃ©es (AppError, NotFoundError, ValidationError)', () => {
    const nf = new NotFoundError('/users/99', 'req_99');
    const json = nf.toJSON();
    assert.equal(json.error.code, 'NOT_FOUND');
    assert.equal(json.error.statusCode, 404);
    assert.equal(json.error.requestId, 'req_99');

    const ve = new ValidationError('Champs invalide', { field: 'email' }, 'req_100');
    assert.equal(ve.code, 'VALIDATION_ERROR');
    assert.equal(ve.statusCode, 400);
  });
});
