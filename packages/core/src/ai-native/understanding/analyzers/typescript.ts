/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-001)
 * TypeScript / JavaScript / TSX / JSX AST Analyzer
 */

import ts from 'typescript';
import type { LanguageAnalyzer } from './base.js';
import { computeSemanticHash } from './base.js';
import type {
  AnalysisStatus,
  CodeDiagnostic,
  CodeExport,
  CodeImport,
  CodeSymbol,
  ComponentClassification,
  FileAnalysis,
  RouteConfidence,
  RouteEndpoint,
  SupportedLanguage,
  SymbolKind
} from '../types.js';

export class TypeScriptAnalyzer implements LanguageAnalyzer {
  public readonly language: SupportedLanguage = 'typescript';
  public readonly supportedExtensions: readonly string[] = [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.mts',
    '.cts'
  ];

  public canHandle(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return this.supportedExtensions.some(ext => lower.endsWith(ext));
  }

  private detectLanguage(filePath: string): SupportedLanguage {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.tsx')) return 'tsx';
    if (lower.endsWith('.jsx')) return 'jsx';
    if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
    return 'typescript';
  }

  private getScriptKind(filePath: string): ts.ScriptKind {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
    if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
    if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return ts.ScriptKind.JS;
    return ts.ScriptKind.TS;
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
    const language = this.detectLanguage(filePath);
    const lineCount = content.split('\n').length;
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    if (content.trim().length === 0) {
      const semanticHash = computeSemanticHash({
        filePath,
        fileHash: context.fileHash,
        language,
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
        language,
        parser: 'TypeScriptCompilerAPI-5.9.3',
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

    const scriptKind = this.getScriptKind(filePath);
    let sourceFile: ts.SourceFile;
    const diagnostics: CodeDiagnostic[] = [];

    try {
      sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.Latest,
        true,
        scriptKind
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown AST syntax failure';
      diagnostics.push({
        severity: 'error',
        message: msg,
        line: 1,
        column: 1,
        code: 'AST_SYNTAX_FATAL'
      });

      const semanticHash = computeSemanticHash({
        filePath,
        fileHash: context.fileHash,
        language,
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
        language,
        parser: 'TypeScriptCompilerAPI-5.9.3',
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

    // Collect parser diagnostics if any
    const parseDiagnostics = (sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics;
    if (parseDiagnostics && parseDiagnostics.length > 0) {
      for (const diag of parseDiagnostics) {
        let line = 1;
        let column = 1;
        if (diag.start !== undefined && sourceFile) {
          const pos = sourceFile.getLineAndCharacterOfPosition(diag.start);
          line = pos.line + 1;
          column = pos.character + 1;
        }
        diagnostics.push({
          severity: 'warning',
          message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
          line,
          column,
          code: `TS${diag.code}`
        });
      }
    }

    const symbols: CodeSymbol[] = [];
    const imports: CodeImport[] = [];
    const exportsList: CodeExport[] = [];
    const dependenciesSet = new Set<string>();

    const visit = (node: ts.Node) => {
      // 1. Imports
      if (ts.isImportDeclaration(node)) {
        const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
        dependenciesSet.add(specifier);
        const isRelative = specifier.startsWith('.') || specifier.startsWith('/');
        const isTypeOnly = node.importClause?.isTypeOnly ?? false;
        let defaultImport: string | undefined;
        let namespaceImport: string | undefined;
        const namedImports: string[] = [];

        if (node.importClause) {
          if (node.importClause.name) {
            defaultImport = node.importClause.name.text;
          }
          if (node.importClause.namedBindings) {
            if (ts.isNamespaceImport(node.importClause.namedBindings)) {
              namespaceImport = node.importClause.namedBindings.name.text;
            } else if (ts.isNamedImports(node.importClause.namedBindings)) {
              for (const elem of node.importClause.namedBindings.elements) {
                namedImports.push(elem.name.text);
              }
            }
          }
        }

        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        imports.push({
          moduleSpecifier: specifier,
          isRelative,
          defaultImport,
          namespaceImport,
          namedImports: namedImports.sort(),
          isTypeOnly,
          line: line + 1
        });
      }

      // 2. Export Declarations (e.g. export { a, b } from './module.js')
      if (ts.isExportDeclaration(node)) {
        const sourceModule = node.moduleSpecifier ? (node.moduleSpecifier as ts.StringLiteral).text : undefined;
        if (sourceModule) {
          dependenciesSet.add(sourceModule);
        }
        const isTypeOnly = node.isTypeOnly;
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const elem of node.exportClause.elements) {
            exportsList.push({
              name: elem.name.text,
              isDefault: false,
              isTypeOnly,
              sourceModule,
              line: line + 1
            });
          }
        } else if (!node.exportClause && sourceModule) {
          // export * from './foo.js'
          exportsList.push({
            name: '*',
            isDefault: false,
            isTypeOnly,
            sourceModule,
            line: line + 1
          });
        }
      }

      // 3. Export Assignment (export default ...)
      if (ts.isExportAssignment(node)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        exportsList.push({
          name: 'default',
          isDefault: true,
          isTypeOnly: false,
          line: line + 1
        });
      }

      // 4. Function Declaration
      if (ts.isFunctionDeclaration(node)) {
        const name = node.name ? node.name.text : 'anonymous';
        const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
        const isDefault = hasModifier(node, ts.SyntaxKind.DefaultKeyword);
        const lineStart = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const lineEnd = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

        if (isExported) {
          exportsList.push({
            name: isDefault ? 'default' : name,
            isDefault,
            isTypeOnly: false,
            line: lineStart
          });
        }

        const classification = classifyComponent(node, name, language);
        const hooks = extractHooksUsed(node);
        const props = extractPropsParameter(node);
        const typeParams = extractTypeParameters(node);

        symbols.push({
          name,
          kind: classification !== 'NOT_COMPONENT' ? 'component' : 'function',
          lineStart,
          lineEnd,
          isExported,
          isDefaultExport: isDefault,
          signature: extractSignatureText(node, sourceFile),
          componentClassification: classification,
          props,
          hooksUsed: hooks.length > 0 ? hooks : undefined,
          typeParameters: typeParams.length > 0 ? typeParams : undefined
        });
      }

      // 5. Class Declaration
      if (ts.isClassDeclaration(node)) {
        const name = node.name ? node.name.text : 'anonymous';
        const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
        const isDefault = hasModifier(node, ts.SyntaxKind.DefaultKeyword);
        const lineStart = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const lineEnd = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

        if (isExported) {
          exportsList.push({
            name: isDefault ? 'default' : name,
            isDefault,
            isTypeOnly: false,
            line: lineStart
          });
        }

        const classification = classifyComponent(node, name, language);
        const typeParams = extractTypeParameters(node);

        symbols.push({
          name,
          kind: classification !== 'NOT_COMPONENT' ? 'component' : 'class',
          lineStart,
          lineEnd,
          isExported,
          isDefaultExport: isDefault,
          signature: `class ${name}`,
          componentClassification: classification,
          typeParameters: typeParams.length > 0 ? typeParams : undefined
        });

        // Extract class methods & getters/setters
        for (const member of node.members) {
          if (ts.isMethodDeclaration(member)) {
            const mName = member.name.getText(sourceFile);
            const mStart = sourceFile.getLineAndCharacterOfPosition(member.getStart()).line + 1;
            const mEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
            symbols.push({
              name: `${name}.${mName}`,
              kind: 'method',
              lineStart: mStart,
              lineEnd: mEnd,
              isExported: false,
              isDefaultExport: false,
              signature: extractSignatureText(member, sourceFile)
            });
          }
        }
      }

      // 6. Interface Declaration
      if (ts.isInterfaceDeclaration(node)) {
        const name = node.name.text;
        const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
        const isDefault = hasModifier(node, ts.SyntaxKind.DefaultKeyword);
        const lineStart = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const lineEnd = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

        if (isExported) {
          exportsList.push({
            name,
            isDefault,
            isTypeOnly: true,
            line: lineStart
          });
        }

        symbols.push({
          name,
          kind: 'interface',
          lineStart,
          lineEnd,
          isExported,
          isDefaultExport: isDefault,
          typeParameters: extractTypeParameters(node)
        });
      }

      // 7. Type Alias Declaration
      if (ts.isTypeAliasDeclaration(node)) {
        const name = node.name.text;
        const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
        const isDefault = hasModifier(node, ts.SyntaxKind.DefaultKeyword);
        const lineStart = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const lineEnd = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

        if (isExported) {
          exportsList.push({
            name,
            isDefault,
            isTypeOnly: true,
            line: lineStart
          });
        }

        symbols.push({
          name,
          kind: 'type_alias',
          lineStart,
          lineEnd,
          isExported,
          isDefaultExport: isDefault,
          typeParameters: extractTypeParameters(node)
        });
      }

      // 8. Enum Declaration
      if (ts.isEnumDeclaration(node)) {
        const name = node.name.text;
        const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
        const isDefault = hasModifier(node, ts.SyntaxKind.DefaultKeyword);
        const lineStart = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const lineEnd = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

        if (isExported) {
          exportsList.push({
            name,
            isDefault,
            isTypeOnly: false,
            line: lineStart
          });
        }

        symbols.push({
          name,
          kind: 'enum',
          lineStart,
          lineEnd,
          isExported,
          isDefaultExport: isDefault
        });
      }

      // 9. Variable Statements (const, let, var, arrow functions, React components)
      if (ts.isVariableStatement(node)) {
        const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
        const lineStart = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const lineEnd = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
        const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;

        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const name = decl.name.text;
            let kind: SymbolKind = isConst ? 'constant' : 'variable';
            let classification: ComponentClassification = 'NOT_COMPONENT';
            let props: string[] | undefined;
            let hooks: string[] | undefined;

            if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
              kind = 'arrow_function';
              classification = classifyComponent(decl.initializer, name, language);
              if (classification !== 'NOT_COMPONENT') {
                kind = 'component';
              }
              hooks = extractHooksUsed(decl.initializer);
              props = extractPropsParameter(decl.initializer);
            }

            if (isExported) {
              exportsList.push({
                name,
                isDefault: false,
                isTypeOnly: false,
                line: lineStart
              });
            }

            symbols.push({
              name,
              kind,
              lineStart,
              lineEnd,
              isExported,
              isDefaultExport: false,
              componentClassification: classification !== 'NOT_COMPONENT' ? classification : undefined,
              props,
              hooksUsed: hooks && hooks.length > 0 ? hooks : undefined
            });
          }
        }
      }

      // 10. Call Expressions for Route Detection (app.get, router.post, etc.)
      if (ts.isCallExpression(node)) {
        const route = detectRoute(node, sourceFile);
        if (route) {
          const lineStart = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          symbols.push({
            name: `${route.method} ${route.path}`,
            kind: 'route',
            lineStart,
            lineEnd: lineStart,
            isExported: false,
            isDefaultExport: false,
            route
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    // Sort deterministically
    symbols.sort((a, b) => a.lineStart - b.lineStart || a.name.localeCompare(b.name));
    imports.sort((a, b) => a.moduleSpecifier.localeCompare(b.moduleSpecifier));
    exportsList.sort((a, b) => a.name.localeCompare(b.name));
    diagnostics.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0));
    const sortedDependencies = Array.from(dependenciesSet).sort();

    let analysisStatus: AnalysisStatus = 'PARSED';
    if (diagnostics.some(d => d.severity === 'error' || d.severity === 'warning')) {
      analysisStatus = symbols.length > 0 || imports.length > 0 ? 'PARSED_WITH_DIAGNOSTICS' : 'OPAQUE_BLOB';
    }

    const semanticHash = computeSemanticHash({
      filePath,
      fileHash: context.fileHash,
      language,
      analysisStatus,
      symbols,
      imports,
      exports: exportsList,
      dependencies: sortedDependencies,
      diagnostics
    });

    return {
      tenantId: context.tenantId,
      projectId: context.projectId,
      filePath,
      fileHash: context.fileHash,
      language,
      parser: 'TypeScriptCompilerAPI-5.9.3',
      analysisStatus,
      semanticHash,
      diagnostics,
      symbols,
      imports,
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

function hasModifier(node: ts.Node, modifierKind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers ? modifiers.some(m => m.kind === modifierKind) : false;
}

function extractTypeParameters(node: ts.Node): string[] {
  const result: string[] = [];
  if ('typeParameters' in node && Array.isArray((node as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }).typeParameters)) {
    for (const tp of (node as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }).typeParameters ?? []) {
      result.push(tp.name.text);
    }
  }
  return result;
}

function extractSignatureText(node: ts.Node, sourceFile: ts.SourceFile): string {
  const fullText = node.getText(sourceFile);
  const braceIdx = fullText.indexOf('{');
  if (braceIdx !== -1) {
    return fullText.substring(0, braceIdx).trim();
  }
  return fullText.slice(0, 120).trim();
}

function classifyComponent(node: ts.Node, name: string, language: SupportedLanguage): ComponentClassification {
  const isPascalCase = /^[A-Z][a-zA-Z0-9]*$/.test(name);
  let hasJsx = false;

  const checkJsx = (child: ts.Node) => {
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      hasJsx = true;
      return;
    }
    ts.forEachChild(child, checkJsx);
  };
  checkJsx(node);

  if (hasJsx) {
    return 'COMPONENT_CONFIRMED';
  }

  if (isPascalCase && (language === 'tsx' || language === 'jsx')) {
    return 'COMPONENT_INFERRED';
  }

  return 'NOT_COMPONENT';
}

function extractHooksUsed(node: ts.Node): string[] {
  const hooks = new Set<string>();
  const scan = (child: ts.Node) => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
      const fnName = child.expression.text;
      if (/^use[A-Z0-9]/.test(fnName)) {
        hooks.add(fnName);
      }
    }
    ts.forEachChild(child, scan);
  };
  scan(node);
  return Array.from(hooks).sort();
}

function extractPropsParameter(node: ts.FunctionLikeDeclarationBase): string[] | undefined {
  if (!node.parameters || node.parameters.length === 0) return undefined;
  const firstParam = node.parameters[0];
  if (!firstParam) return undefined;

  const props: string[] = [];
  if (ts.isObjectBindingPattern(firstParam.name)) {
    for (const elem of firstParam.name.elements) {
      if (ts.isIdentifier(elem.name)) {
        props.push(elem.name.text);
      }
    }
  } else if (ts.isIdentifier(firstParam.name)) {
    props.push(firstParam.name.text);
  }

  return props.length > 0 ? props.sort() : undefined;
}

function detectRoute(call: ts.CallExpression, sourceFile: ts.SourceFile): RouteEndpoint | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const methodProp = call.expression.name.text.toUpperCase();
  const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'USE'] as const;

  if (!(validMethods as readonly string[]).includes(methodProp)) {
    return null;
  }

  if (call.arguments.length === 0) return null;
  const firstArg = call.arguments[0];
  if (!firstArg || !ts.isStringLiteral(firstArg)) return null;

  const routePath = firstArg.text;
  const { line } = sourceFile.getLineAndCharacterOfPosition(call.getStart());

  return {
    method: methodProp as (typeof validMethods)[number],
    path: routePath,
    confidence: 'CONFIRMED',
    line: line + 1
  };
}
