/**
 * VibeCode Studio - Project Settings Service (CORE-006)
 */

import type { Role } from '../identity/permissions.js';
import { assertPermission } from '../identity/permissions.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { ProjectStore } from '../identity/project.js';
import { AuditStore } from '../observability/audit.js';
import { maskSecret } from '../security/secrets.js';
import type { ProjectSettings, ProjectStack, UpdateProjectSettingsInput } from './types.js';

const SENSITIVE_KEY_PATTERN = /(KEY|SECRET|PASSWORD|TOKEN|AUTH|CREDENTIAL|PRIVATE)/i;

export class SettingsService {
  private settingsStore = new Map<string, ProjectSettings>();

  constructor(
    private projectStore: ProjectStore,
    private auditStore?: AuditStore
  ) {}

  private getStoreKey(tenantId: string, projectId: string): string {
    return `${tenantId}:${projectId}`;
  }

  private getOrCreateDefaultSettings(tenantId: string, projectId: string): ProjectSettings {
    const key = this.getStoreKey(tenantId, projectId);
    let settings = this.settingsStore.get(key);
    if (!settings) {
      settings = {
        projectId,
        tenantId,
        stack: {
          framework: 'html-vanilla',
          buildTool: 'none',
          nodeVersion: '22'
        },
        envVars: {},
        tags: ['web', 'vibecode'],
        updatedAt: new Date()
      };
      this.settingsStore.set(key, settings);
    }
    return settings;
  }

  public getSettings(
    tenantId: string,
    projectId: string,
    maskSensitive: boolean = true,
    userRole: Role = 'VIEWER',
    requestId?: string
  ): ProjectSettings {
    if (!tenantId) {
      throw new ValidationError('Le tenantId est obligatoire', { field: 'tenantId' }, requestId);
    }
    if (!projectId) {
      throw new ValidationError('Le projectId est obligatoire', { field: 'projectId' }, requestId);
    }

    const project = this.projectStore.getProject(tenantId, projectId);
    if (!project) {
      throw new NotFoundError(`Projet ${projectId} introuvable pour le tenant ${tenantId}`, requestId);
    }
    assertPermission(userRole, 'PROJECT_READ', requestId);

    const raw = this.getOrCreateDefaultSettings(tenantId, projectId);

    const maskedVars: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.envVars)) {
      if (maskSensitive && SENSITIVE_KEY_PATTERN.test(k)) {
        maskedVars[k] = maskSecret(v);
      } else {
        maskedVars[k] = v;
      }
    }

    return {
      projectId: raw.projectId,
      tenantId: raw.tenantId,
      stack: { ...raw.stack },
      envVars: maskedVars,
      tags: [...raw.tags],
      updatedAt: raw.updatedAt
    };
  }

  public updateSettings(
    tenantId: string,
    projectId: string,
    input: UpdateProjectSettingsInput,
    userRole: Role = 'ENGINEER',
    requestId?: string
  ): ProjectSettings {
    if (!tenantId) {
      throw new ValidationError('Le tenantId est obligatoire', { field: 'tenantId' }, requestId);
    }
    if (!projectId) {
      throw new ValidationError('Le projectId est obligatoire', { field: 'projectId' }, requestId);
    }

    const project = this.projectStore.getProject(tenantId, projectId);
    if (!project) {
      throw new NotFoundError(`Projet ${projectId} introuvable pour le tenant ${tenantId}`, requestId);
    }
    assertPermission(userRole, 'PROJECT_UPDATE', requestId);

    const current = this.getOrCreateDefaultSettings(tenantId, projectId);
    const now = new Date();

    const updatedStack: ProjectStack = {
      framework: input.stack?.framework ?? current.stack.framework,
      buildTool: input.stack?.buildTool ?? current.stack.buildTool,
      nodeVersion: input.stack?.nodeVersion ?? current.stack.nodeVersion
    };

    const updatedEnvVars = input.envVars !== undefined
      ? { ...current.envVars, ...input.envVars }
      : { ...current.envVars };

    const updatedTags = input.tags !== undefined
      ? [...new Set(input.tags)]
      : [...current.tags];

    const updated: ProjectSettings = {
      projectId,
      tenantId,
      stack: updatedStack,
      envVars: updatedEnvVars,
      tags: updatedTags,
      updatedAt: now
    };

    this.settingsStore.set(this.getStoreKey(tenantId, projectId), updated);

    // Audit event
    if (this.auditStore) {
      this.auditStore.record({
        tenantId,
        userId: 'user',
        action: 'SETTINGS_UPDATE',
        resourceType: 'project_settings',
        resourceId: projectId,
        status: 'SUCCESS',
        metadata: {
          updatedFields: Object.keys(input)
        },
        requestId: requestId ?? 'req_settings_auto'
      });
    }

    return this.getSettings(tenantId, projectId, true, userRole, requestId);
  }

  public clear(): void {
    this.settingsStore.clear();
  }
}
