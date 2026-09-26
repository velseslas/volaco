/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-001)
 * JSON Structural Analyzer
 */

import type { LanguageAnalyzer } from './base.js';
import { computeSemanticHash } from './base.js';
import type {
  AnalysisStatus,
  CodeDiagnostic,
  CodeExport,
  CodeSymbol,
  FileAnalysis,
  SupportedLanguage
} from '../types.js';

export class JsonAnalyzer implements LanguageAnalyzer {
  public readonly language: SupportedLanguage = 'json';
  public readonly supportedExtensions: readonly string[] = ['.json'];

  public canHandle(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.json');
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
    const lineCount = content.split('\n').length;
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    if (content.trim().length === 0) {
      const semanticHash = computeSemanticHash({
        filePath,
        fileHash: context.fileHash,
        language: 'json',
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
        language: 'json',
        parser: 'DeterministicJsonParser',
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

    let parsed: unknown;
    const diagnostics: CodeDiagnostic[] = [];

    try {
      parsed = JSON.parse(content);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid JSON format';
      diagnostics.push({
        severity: 'error',
        message: msg,
        line: 1,
        column: 1,
        code: 'JSON_PARSE_ERROR'
      });

      const semanticHash = computeSemanticHash({
        filePath,
        fileHash: context.fileHash,
        language: 'json',
        analysisStatus: 'OPAQUE_BLOB',
        symbols: [],
        imports: [],
        exports: [],
        dependencies: [],
        diagnostics
      });

      return {
        tenantId: context.tenantId,
        projectId: context.projectId,
        filePath,
        fileHash: context.fileHash,
        language: 'json',
        parser: 'DeterministicJsonParser',
        analysisStatus: 'OPAQUE_BLOB',
        semanticHash,
        diagnostics,
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
    const exportsList: CodeExport[] = [];
    const dependenciesSet = new Set<string>();

    if (parsed && typeof parsed === 'object') {
      const isPackageJson = filePath.toLowerCase().endsWith('package.json');

      if (isPackageJson && !Array.isArray(parsed)) {
        const pkg = parsed as Record<string, unknown>;

        if (pkg.name && typeof pkg.name === 'string') {
          symbols.push({
            name: pkg.name,
            kind: 'constant',
            lineStart: 1,
            lineEnd: lineCount,
            isExported: true,
            isDefaultExport: true,
            signature: `package: ${pkg.name}`
          });
        }

        // Dependencies
        const depSections = ['dependencies', 'devDependencies', 'peerDependencies'] as const;
        for (const sec of depSections) {
          const sectionObj = pkg[sec];
          if (sectionObj && typeof sectionObj === 'object') {
            for (const depName of Object.keys(sectionObj)) {
              dependenciesSet.add(depName);
              symbols.push({
                name: `${sec}:${depName}`,
                kind: 'variable',
                lineStart: 1,
                lineEnd: 1,
                isExported: false,
                isDefaultExport: false,
                signature: `${depName}@${(sectionObj as Record<string, string>)[depName]}`
              });
            }
          }
        }

        // Scripts
        if (pkg.scripts && typeof pkg.scripts === 'object') {
          for (const scriptKey of Object.keys(pkg.scripts)) {
            symbols.push({
              name: `script:${scriptKey}`,
              kind: 'function',
              lineStart: 1,
              lineEnd: 1,
              isExported: false,
              isDefaultExport: false,
              signature: `npm run ${scriptKey}`
            });
          }
        }
      } else if (!Array.isArray(parsed)) {
        // Standard JSON object keys
        const rootKeys = Object.keys(parsed as Record<string, unknown>).sort();
        for (const key of rootKeys) {
          symbols.push({
            name: key,
            kind: 'variable',
            lineStart: 1,
            lineEnd: lineCount,
            isExported: true,
            isDefaultExport: false,
            signature: `key: ${key}`
          });
          exportsList.push({
            name: key,
            isDefault: false,
            isTypeOnly: false,
            line: 1
          });
        }
      }
    }

    symbols.sort((a, b) => a.name.localeCompare(b.name));
    exportsList.sort((a, b) => a.name.localeCompare(b.name));
    const sortedDependencies = Array.from(dependenciesSet).sort();

    const semanticHash = computeSemanticHash({
      filePath,
      fileHash: context.fileHash,
      language: 'json',
      analysisStatus: 'PARSED',
      symbols,
      imports: [],
      exports: exportsList,
      dependencies: sortedDependencies,
      diagnostics: []
    });

    return {
      tenantId: context.tenantId,
      projectId: context.projectId,
      filePath,
      fileHash: context.fileHash,
      language: 'json',
      parser: 'DeterministicJsonParser',
      analysisStatus: 'PARSED',
      semanticHash,
      diagnostics: [],
      symbols,
      imports: [],
      exports: exportsList,
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
