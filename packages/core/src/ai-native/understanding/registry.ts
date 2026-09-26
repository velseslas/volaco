/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-001)
 * Language Analyzer Registry
 */

import type { LanguageAnalyzer } from './analyzers/base.js';
import { TypeScriptAnalyzer } from './analyzers/typescript.js';
import { JsonAnalyzer } from './analyzers/json.js';
import { HtmlAnalyzer } from './analyzers/html.js';
import { CssAnalyzer } from './analyzers/css.js';

export class LanguageAnalyzerRegistry {
  private analyzers: LanguageAnalyzer[] = [];

  constructor() {
    // Register built-in analyzers in order of precedence
    this.register(new TypeScriptAnalyzer());
    this.register(new JsonAnalyzer());
    this.register(new HtmlAnalyzer());
    this.register(new CssAnalyzer());
  }

  public register(analyzer: LanguageAnalyzer): void {
    this.analyzers.push(analyzer);
  }

  public resolve(filePath: string): LanguageAnalyzer | null {
    for (const analyzer of this.analyzers) {
      if (analyzer.canHandle(filePath)) {
        return analyzer;
      }
    }
    return null;
  }
}
