/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-001)
 * HTML Structural Scanner
 */

import type { LanguageAnalyzer } from './base.js';
import { computeSemanticHash } from './base.js';
import type {
  AnalysisStatus,
  CodeDiagnostic,
  CodeExport,
  CodeImport,
  CodeSymbol,
  FileAnalysis,
  SupportedLanguage
} from '../types.js';

export class HtmlAnalyzer implements LanguageAnalyzer {
  public readonly language: SupportedLanguage = 'html';
  public readonly supportedExtensions: readonly string[] = ['.html', '.htm'];

  public canHandle(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return this.supportedExtensions.some(ext => lower.endsWith(ext));
  }

  public analyze(
    content: string,
    filePath: string,
    context: {
      tenantId: string;
      projectId: string;
      fileHash: string;
      analyzerVersion: string;
    }
  ): FileAnalysis {
    const startMs = Date.now();
    const lines = content.split('\n');
    const lineCount = lines.length;
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    if (content.trim().length === 0) {
      const semanticHash = computeSemanticHash({
        filePath,
        fileHash: context.fileHash,
        language: 'html',
        analysisStatus: 'EMPTY',
        symbols: [],
        imports: [],
        exports: [],
        dependencies: [],
        diagnostics: []
      });

      return {
        tenantId: context.tenantId,
        projectId: context.projectId,
        filePath,
        fileHash: context.fileHash,
        language: 'html',
        parser: 'DeterministicHtmlScanner',
        analysisStatus: 'EMPTY',
        semanticHash,
        diagnostics: [],
        symbols: [],
        imports: [],
        exports: [],
        dependencies: [],
        lineCount,
        sizeBytes,
        executionMeta: {
          analyzedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs,
          analyzerVersion: context.analyzerVersion
        }
      };
    }

    const symbols: CodeSymbol[] = [];
    const imports: CodeImport[] = [];
    const dependenciesSet = new Set<string>();
    const diagnostics: CodeDiagnostic[] = [];

    // Title tag scan
    const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      symbols.push({
        name: 'page:title',
        kind: 'constant',
        lineStart: 1,
        lineEnd: 1,
        isExported: true,
        isDefaultExport: false,
        signature: titleMatch[1].trim()
      });
    }

    // Line by line scanning for scripts, stylesheets, and main structural IDs
    for (let i = 0; i < lines.length; i++) {
      const lineStr = lines[i] ?? '';
      const lineNum = i + 1;

      // Script sources: <script src="...">
      const scriptSrcMatches = lineStr.matchAll(/<script[^>]+src=["']([^"']+)["']/gi);
      for (const m of scriptSrcMatches) {
        if (m[1]) {
          const specifier = m[1];
          dependenciesSet.add(specifier);
          imports.push({
            moduleSpecifier: specifier,
            isRelative: specifier.startsWith('.') || specifier.startsWith('/'),
            namedImports: [],
            isTypeOnly: false,
            line: lineNum
          });
        }
      }

      // Stylesheet links: <link rel="stylesheet" href="...">
      const cssMatches = lineStr.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]*>/gi);
      for (const m of cssMatches) {
        if (m[0].includes('stylesheet') && m[1]) {
          const specifier = m[1];
          dependenciesSet.add(specifier);
          imports.push({
            moduleSpecifier: specifier,
            isRelative: specifier.startsWith('.') || specifier.startsWith('/'),
            namedImports: [],
            isTypeOnly: false,
            line: lineNum
          });
        }
      }

      // Root IDs: <div id="..."> or similar
      const idMatches = lineStr.matchAll(/\sid=["']([^"']+)["']/gi);
      for (const m of idMatches) {
        if (m[1]) {
          symbols.push({
            name: `dom:#${m[1]}`,
            kind: 'variable',
            lineStart: lineNum,
            lineEnd: lineNum,
            isExported: false,
            isDefaultExport: false,
            signature: `id="${m[1]}"`
          });
        }
      }
    }

    symbols.sort((a, b) => a.lineStart - b.lineStart || a.name.localeCompare(b.name));
    imports.sort((a, b) => a.line - b.line || a.moduleSpecifier.localeCompare(b.moduleSpecifier));
    const sortedDependencies = Array.from(dependenciesSet).sort();

    const semanticHash = computeSemanticHash({
      filePath,
      fileHash: context.fileHash,
      language: 'html',
      analysisStatus: 'PARSED',
      symbols,
      imports,
      exports: [],
      dependencies: sortedDependencies,
      diagnostics: []
    });

    return {
      tenantId: context.tenantId,
      projectId: context.projectId,
      filePath,
      fileHash: context.fileHash,
      language: 'html',
      parser: 'DeterministicHtmlScanner',
      analysisStatus: 'PARSED',
      semanticHash,
      diagnostics: [],
      symbols,
      imports,
      exports: [],
      dependencies: sortedDependencies,
      lineCount,
      sizeBytes,
      executionMeta: {
        analyzedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        analyzerVersion: context.analyzerVersion
      }
    };
  }
}
