/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Central Tool Registry
 * Enforces Capability Boundaries and RBAC
 */

import { assertPermission, type Permission, type Role } from '../../../identity/permissions.js';
import {
  type ToolDefinition,
  ToolExecutionError,
  AgentCapabilityError,
  type ToolExecutionResult,
  type AgentRole
} from '../types.js';
import { TOOL_DEFINITIONS } from './definitions.js';

export interface ToolExecutionContext {
  readonly tenantId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly userRole: Role;
  readonly agentRole?: AgentRole | undefined;
  readonly allowedTools?: readonly string[] | undefined;
  readonly requestId?: string | undefined;
  // P0-PROD — true uniquement si un humain a explicitement approuvé ce run
  // (confirmation=true) ou invoqué executePlan directement. Les outils à
  // écriture (execute_mutation) exigent ce drapeau pour les plans HIGH /
  // CRITICAL / BREAKING au lieu des anciens `allowHighRisk: true` en dur.
  readonly highRiskApproved?: boolean | undefined;
}

export type ToolHandler = (
  input: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<unknown>;

export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();
  private readonly handlers = new Map<string, ToolHandler>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    for (const [name, def] of Object.entries(TOOL_DEFINITIONS)) {
      this.definitions.set(name, def);
    }
  }

  public register(def: ToolDefinition, handler?: ToolHandler | undefined): void {
    this.definitions.set(def.name, def);
    if (handler) {
      this.handlers.set(def.name, handler);
    }
  }

  public registerHandler(name: string, handler: ToolHandler): void {
    if (!this.definitions.has(name)) {
      throw new ToolExecutionError(name, `Impossible d'enregistrer le gestionnaire : outil '${name}' non declare`);
    }
    this.handlers.set(name, handler);
  }

  public get(name: string): ToolDefinition | undefined {
    return this.definitions.get(name) ?? this.definitions.get(name.toUpperCase()) ?? this.definitions.get(name.toLowerCase());
  }

  public has(name: string): boolean {
    return (
      this.definitions.has(name) ||
      this.definitions.has(name.toUpperCase()) ||
      this.definitions.has(name.toLowerCase())
    );
  }

  public list(): readonly ToolDefinition[] {
    // Return distinct definitions by name
    return Array.from(this.definitions.values());
  }

  public async execute(
    name: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const def = this.get(name);

    if (!def) {
      throw new ToolExecutionError(name, `Outil inconnu ou non enregistre: '${name}'`);
    }

    // Capability Boundary Check: if agentRole and allowedTools are specified, enforce boundaries
    if (context.allowedTools && context.allowedTools.length > 0) {
      const allowedSet = new Set(
        context.allowedTools.flatMap((t) => [t, t.toUpperCase(), t.toLowerCase()])
      );
      if (!allowedSet.has(name) && !allowedSet.has(def.name)) {
        throw new AgentCapabilityError(
          context.agentRole ?? 'AGENT',
          name,
          context.allowedTools,
          context.requestId
        );
      }
    }

    // RBAC validation
    for (const perm of def.permissions) {
      assertPermission(context.userRole, perm as Permission, context.requestId);
    }

    const handler = this.handlers.get(name) ?? this.handlers.get(def.name);
    if (!handler) {
      // P2 — plus de stub « succès » silencieux (constat d'audit : une étape
      // read_file « réussissait » sans rien lire). Un tool déclaré mais non
      // câblé est une ERREUR explicite — le plan échoue honnêtement au lieu
      // de prétendre avoir travaillé.
      return {
        tool: name,
        success: false,
        error: `Outil '${name}' déclaré mais non câblé dans ce runtime (aucun handler enregistré)`,
        durationMs: Date.now() - startTime
      };
    }

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new ToolExecutionError(name, `Delai d execution depasse (${def.timeoutMs}ms)`));
        }, def.timeoutMs);
      });

      const output = await Promise.race([handler(input, context), timeoutPromise]);

      return {
        tool: name,
        success: true,
        output,
        durationMs: Date.now() - startTime
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        tool: name,
        success: false,
        output: null,
        error: msg,
        durationMs: Date.now() - startTime
      };
    }
  }
}
