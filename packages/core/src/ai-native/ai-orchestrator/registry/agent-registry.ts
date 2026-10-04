/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-010)
 * ÉTAPE 34 — Agent Registry (source unique du roster d'agents exécutables)
 *
 * UN SEUL registry : il détient LES MÊMES instances d'agents que le
 * scheduler (vue par domaine) et l'exécuteur (résolution par ID/capability).
 * Aucun deuxième système d'exécution, aucun deuxième roster, aucune
 * duplication : le registry ne fait que référencer et décrire les agents.
 *
 * API : register / unregister / get / has / list / resolveByCapability /
 * resolveByDomain. Résolution déterministe : resolveByCapability retourne
 * TOUS les candidats (l'appelant décide — le routeur refuse l'ambiguïté).
 */

import { deepFreeze } from '../canonical.js';
import type { AgentDomain, AgentCapability } from '../types.js';
import type { BaseSpecializedAgent } from '../agents/base-agent.js';

export interface RegisteredAgent {
  /** Identifiant unique de l'agent (id du contrat É32). */
  readonly id: string;
  readonly name: string;
  readonly domain: AgentDomain;
  readonly capabilities: readonly AgentCapability[];
  readonly description: string;
  /** L'agent/exécuteur RÉEL (même instance que le scheduler). */
  readonly agent: BaseSpecializedAgent;
  /** Dépendance provider IA déclarée par l'agent (vide = déterministe). */
  readonly requiresProviderCapabilities: readonly string[];
}

export class AgentRegistryService {
  private readonly agents = new Map<string, RegisteredAgent>();

  /**
   * Enregistre un agent (prévention stricte de doublon). L'entrée décrit
   * l'agent SANS le copier : `entry.agent` est l'instance réelle.
   */
  public register(agent: BaseSpecializedAgent): RegisteredAgent {
    const def = agent.definition;
    if (this.agents.has(def.id)) {
      throw new Error(`Agent déjà enregistré : '${def.id}'`);
    }
    const entry: RegisteredAgent = deepFreeze({
      id: def.id,
      name: def.name,
      domain: def.domain,
      capabilities: [...def.capabilities],
      description: def.description,
      agent,
      requiresProviderCapabilities: [...def.requiredProviderCapabilities]
    });
    this.agents.set(def.id, entry);
    return entry;
  }

  /** Retire un agent du registry. Retourne true s'il existait. */
  public unregister(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  public get(agentId: string): RegisteredAgent | undefined {
    return this.agents.get(agentId);
  }

  public has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /** Toutes les entrées, triées par id (déterministe). */
  public list(): readonly RegisteredAgent[] {
    return Array.from(this.agents.values()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** TOUS les agents déclarant cette capability (triés par id — déterministe). */
  public resolveByCapability(capability: AgentCapability): readonly RegisteredAgent[] {
    return this.list().filter((entry) => entry.capabilities.includes(capability));
  }

  /** L'agent d'un domaine (premier enregistré si plusieurs — déterministe). */
  public resolveByDomain(domain: AgentDomain): RegisteredAgent | undefined {
    for (const entry of this.list()) {
      if (entry.domain === domain) return entry;
    }
    return undefined;
  }

  /**
   * Vue par domaine pour le scheduler (mêmes instances). Si deux agents
   * partagent un domaine, le premier enregistré gagne (déterministe).
   */
  public domainMap(): Map<AgentDomain, BaseSpecializedAgent> {
    const map = new Map<AgentDomain, BaseSpecializedAgent>();
    for (const entry of this.list()) {
      if (!map.has(entry.domain)) {
        map.set(entry.domain, entry.agent);
      }
    }
    return map;
  }
}
