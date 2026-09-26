/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-014)
 * Dependency Analyzer - Analyzes Required Modules & Dependencies
 */

export class DependencyAnalyzer {
  public analyzeDependencies(affectedModules: readonly string[]): readonly string[] {
    const deps = new Set<string>();
    for (const mod of affectedModules) {
      if (mod.includes('views') || mod.includes('components')) {
        deps.add('src/styles');
      }
      if (mod.includes('charts') || mod.includes('analytics')) {
        deps.add('src/services/activity');
      }
    }
    return Array.from(deps);
  }
}
