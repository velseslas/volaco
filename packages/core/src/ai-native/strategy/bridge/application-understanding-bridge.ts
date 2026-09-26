/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-016)
 * Application Understanding Bridge - Correlates with Application DNA (AINT-001) & Understanding (AINT-003/008)
 */

import type { ApplicationDNA } from '../../dna/types.js';

export interface ArchitecturalSummary {
  appName: string;
  framework: string;
  hasStateManagement: boolean;
  componentsCount: number;
}

export class StrategyApplicationUnderstandingBridge {
  /**
   * Summarizes architectural baseline from Application DNA.
   */
  public summarizeArchitecture(dna?: ApplicationDNA): ArchitecturalSummary {
    if (!dna) {
      return {
        appName: 'Unknown App',
        framework: 'Vanilla / HTML5',
        hasStateManagement: false,
        componentsCount: 1
      };
    }

    return {
      appName: dna.projectId || 'Volaco App',
      framework: dna.stack?.framework?.name || dna.summary?.primaryFramework || 'HTML5/Tailwind',
      hasStateManagement: Boolean(dna.stack?.stateManagement),
      componentsCount: dna.components?.length || 1
    };
  }
}
