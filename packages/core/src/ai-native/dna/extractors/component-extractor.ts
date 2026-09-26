/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-002)
 * Component Extractor (Profiles, Props, Hooks)
 */

import type { ProjectAnalysisSummary } from '../../understanding/types.js';
import type { ComponentProfile } from '../types.js';
import { canonicalSort } from './base.js';

export class ComponentExtractor {
  public extract(summary: ProjectAnalysisSummary): ComponentProfile[] {
    const profiles: ComponentProfile[] = [];

    for (const [filePath, fa] of Object.entries(summary.fileAnalyses)) {
      for (const symbol of fa.symbols) {
        const isComp =
          symbol.componentClassification === 'COMPONENT_CONFIRMED' ||
          symbol.componentClassification === 'COMPONENT_INFERRED' ||
          symbol.kind === 'component';

        if (isComp) {
          const hooks = symbol.hooksUsed ? Array.from(new Set(symbol.hooksUsed)).sort() : [];
          const propsCount = symbol.props ? symbol.props.length : 0;
          const classification =
            symbol.componentClassification === 'COMPONENT_CONFIRMED'
              ? 'COMPONENT_CONFIRMED'
              : 'COMPONENT_INFERRED';

          profiles.push({
            name: symbol.name,
            filePath,
            classification,
            propsCount,
            hooksUsed: hooks,
            lineStart: symbol.lineStart,
            lineEnd: symbol.lineEnd
          });
        }
      }
    }

    return canonicalSort(profiles, cp => `${cp.filePath}:${String(cp.lineStart).padStart(6, '0')}:${cp.name}`);
  }
}
