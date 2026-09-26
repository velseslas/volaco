import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectStore,
  AuditStore,
  SettingsService,
  ValidationError,
  NotFoundError,
  ForbiddenError
} from '../src/index.js';

describe('CORE-006 : Project Settings Service Unit Tests', () => {
  let projectStore: ProjectStore;
  let auditStore: AuditStore;
  let settingsService: SettingsService;
  const tenantId = 'ten_set_001';
  let project: { id: string; name: string };

  beforeEach(() => {
    projectStore = new ProjectStore();
    auditStore = new AuditStore();
    settingsService = new SettingsService(projectStore, auditStore);
    project = projectStore.createProject(tenantId, 'Configured SaaS App');
  });

  it('doit renvoyer des paramètres par défaut pour un nouveau projet', () => {
    const settings = settingsService.getSettings(tenantId, project.id, true, 'VIEWER');
    assert.equal(settings.projectId, project.id);
    assert.equal(settings.tenantId, tenantId);
    assert.equal(settings.stack.framework, 'html-vanilla');
    assert.equal(settings.stack.nodeVersion, '22');
    assert.deepEqual(settings.envVars, {});
    assert.ok(settings.tags.includes('vibecode'));
  });

  it('doit mettre à jour la stack et les variables d environnement', () => {
    const updated = settingsService.updateSettings(
      tenantId,
      project.id,
      {
        stack: { framework: 'react', buildTool: 'vite', nodeVersion: '24' },
        envVars: { PUBLIC_API_URL: 'https://api.vibecode.studio' },
        tags: ['saas', 'analytics', 'react']
      },
      'ENGINEER',
      'req_set_01'
    );

    assert.equal(updated.stack.framework, 'react');
    assert.equal(updated.stack.buildTool, 'vite');
    assert.equal(updated.stack.nodeVersion, '24');
    assert.equal(updated.envVars['PUBLIC_API_URL'], 'https://api.vibecode.studio');
    assert.ok(updated.tags.includes('analytics'));

    // Vérifier l'audit
    const audits = auditStore.query(tenantId, { action: 'SETTINGS_UPDATE' });
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.resourceId, project.id);
    assert.equal(audits[0]!.requestId, 'req_set_01');
  });

  it('doit masquer automatiquement les clés d environnement sensibles (API_KEY, SECRET, PASSWORD)', () => {
    settingsService.updateSettings(
      tenantId,
      project.id,
      {
        envVars: {
          OPENAI_API_KEY: 'sk-proj-supersecret1234567890abcdef',
          DATABASE_PASSWORD: 'MyUltraSecurePassword2026',
          PUBLIC_APP_NAME: 'VibeCode Client'
        }
      },
      'ENGINEER'
    );

    // Lecture avec masquage actif
    const maskedSettings = settingsService.getSettings(tenantId, project.id, true, 'VIEWER');
    assert.ok(
      maskedSettings.envVars['OPENAI_API_KEY']!.includes('...') ||
      maskedSettings.envVars['OPENAI_API_KEY']!.includes('***')
    );
    assert.notEqual(maskedSettings.envVars['OPENAI_API_KEY'], 'sk-proj-supersecret1234567890abcdef');
    assert.ok(
      maskedSettings.envVars['DATABASE_PASSWORD']!.includes('...') ||
      maskedSettings.envVars['DATABASE_PASSWORD']!.includes('***')
    );
    assert.notEqual(maskedSettings.envVars['DATABASE_PASSWORD'], 'MyUltraSecurePassword2026');
    assert.equal(maskedSettings.envVars['PUBLIC_APP_NAME'], 'VibeCode Client');
  });

  it('doit faire respecter les règles de permissions RBAC', () => {
    // VIEWER peut lire les paramètres
    const settings = settingsService.getSettings(tenantId, project.id, true, 'VIEWER');
    assert.ok(settings);

    // VIEWER ne peut pas mettre à jour les paramètres
    assert.throws(
      () => settingsService.updateSettings(tenantId, project.id, { tags: ['hack'] }, 'VIEWER'),
      ForbiddenError
    );
  });

  it('doit garantir l étanchéité multi-tenant', () => {
    const rivalTenant = 'ten_rival_hacker';
    assert.throws(
      () => settingsService.getSettings(rivalTenant, project.id),
      NotFoundError
    );
    assert.throws(
      () => settingsService.updateSettings(rivalTenant, project.id, {}),
      NotFoundError
    );
  });
});
