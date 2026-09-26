/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-001)
 * Code Intelligence & AST Engine Unit and Integration Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CodeIntelligenceService,
  ForbiddenError,
  NotFoundError,
  FileStore,
  ProjectStore
} from '../src/index.js';
import { AnalysisLruCache } from '../src/ai-native/understanding/cache.js';
import { TypeScriptAnalyzer } from '../src/ai-native/understanding/analyzers/typescript.js';
import { JsonAnalyzer } from '../src/ai-native/understanding/analyzers/json.js';
import { HtmlAnalyzer } from '../src/ai-native/understanding/analyzers/html.js';
import { CssAnalyzer } from '../src/ai-native/understanding/analyzers/css.js';
import type { IReadOnlyFileSource } from '../src/index.js';

describe('AINT-001 : Code Intelligence & AST Engine Tests', () => {

  describe('1. Multi-Language Parsing & AST Extraction', () => {
    const service = new CodeIntelligenceService();

    it('1.1 doit analyser un fichier TypeScript avec interfaces, types et fonctions', () => {
      const tsCode = `
        export interface UserProfile {
          id: string;
          email: string;
        }
        export type RoleType = 'admin' | 'user';
        export function getUser(id: string): UserProfile {
          return { id, email: 'test@example.com' };
        }
      `;

      const analysis = service.analyzeSource(tsCode, 'src/user.ts');
      assert.strictEqual(analysis.language, 'typescript');
      assert.strictEqual(analysis.analysisStatus, 'PARSED');
      assert.strictEqual(analysis.symbols.length, 3);

      const iface = analysis.symbols.find(s => s.name === 'UserProfile');
      assert.ok(iface);
      assert.strictEqual(iface?.kind, 'interface');
      assert.strictEqual(iface?.isExported, true);

      const fn = analysis.symbols.find(s => s.name === 'getUser');
      assert.ok(fn);
      assert.strictEqual(fn?.kind, 'function');
      assert.strictEqual(fn?.isExported, true);
    });

    it('1.2 doit analyser un fichier JavaScript ES6+ avec classes et exports par défaut', () => {
      const jsCode = `
        import { EventEmitter } from 'events';
        export default class Calculator extends EventEmitter {
          add(a, b) { return a + b; }
        }
      `;

      const analysis = service.analyzeSource(jsCode, 'src/calculator.js');
      assert.strictEqual(analysis.language, 'javascript');
      assert.strictEqual(analysis.analysisStatus, 'PARSED');

      const cls = analysis.symbols.find(s => s.name === 'Calculator');
      assert.ok(cls);
      assert.strictEqual(cls?.kind, 'class');
      assert.strictEqual(cls?.isDefaultExport, true);

      const method = analysis.symbols.find(s => s.name === 'Calculator.add');
      assert.ok(method);
      assert.strictEqual(method?.kind, 'method');
    });

    it('1.3 doit analyser un composant React TSX et détecter COMPONENT_CONFIRMED avec props et hooks', () => {
      const tsxCode = `
        import React, { useState } from 'react';
        export interface ButtonProps { label: string; onClick: () => void; }
        export function ActionButton({ label, onClick }: ButtonProps) {
          const [count, setCount] = useState(0);
          return <button onClick={onClick}>{label} ({count})</button>;
        }
      `;

      const analysis = service.analyzeSource(tsxCode, 'src/components/ActionButton.tsx');
      assert.strictEqual(analysis.language, 'tsx');
      assert.strictEqual(analysis.analysisStatus, 'PARSED');

      const comp = analysis.symbols.find(s => s.name === 'ActionButton');
      assert.ok(comp);
      assert.strictEqual(comp?.kind, 'component');
      assert.strictEqual(comp?.componentClassification, 'COMPONENT_CONFIRMED');
      assert.ok(comp?.hooksUsed?.includes('useState'));
      assert.ok(comp?.props?.includes('label'));
      assert.ok(comp?.props?.includes('onClick'));
    });

    it('1.4 doit analyser un composant JSX avec fonction fléchée', () => {
      const jsxCode = `
        import React from 'react';
        export const Badge = ({ text }) => {
          return <span className="badge">{text}</span>;
        };
      `;

      const analysis = service.analyzeSource(jsxCode, 'src/Badge.jsx');
      assert.strictEqual(analysis.language, 'jsx');
      assert.strictEqual(analysis.analysisStatus, 'PARSED');

      const comp = analysis.symbols.find(s => s.name === 'Badge');
      assert.ok(comp);
      assert.strictEqual(comp?.kind, 'component');
      assert.strictEqual(comp?.componentClassification, 'COMPONENT_CONFIRMED');
    });

    it('1.5 doit analyser package.json et extraire dépendances et scripts', () => {
      const pkgJson = JSON.stringify({
        name: 'my-vibecoding-app',
        version: '1.0.0',
        dependencies: {
          tailwindcss: '^3.4.0',
          react: '^18.2.0'
        },
        scripts: {
          build: 'vite build',
          test: 'vitest'
        }
      });

      const analysis = service.analyzeSource(pkgJson, 'package.json');
      assert.strictEqual(analysis.language, 'json');
      assert.strictEqual(analysis.analysisStatus, 'PARSED');
      assert.ok(analysis.dependencies.includes('react'));
      assert.ok(analysis.dependencies.includes('tailwindcss'));

      const buildScript = analysis.symbols.find(s => s.name === 'script:build');
      assert.ok(buildScript);
    });

    it('1.6 doit analyser un fichier HTML5 et extraire scripts et links css', () => {
      const htmlCode = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Studio App</title>
          <link rel="stylesheet" href="/assets/style.css">
          <script src="/js/main.js"></script>
        </head>
        <body>
          <div id="root"></div>
        </body>
        </html>
      `;

      const analysis = service.analyzeSource(htmlCode, 'public/index.html');
      assert.strictEqual(analysis.language, 'html');
      assert.strictEqual(analysis.analysisStatus, 'PARSED');

      const title = analysis.symbols.find(s => s.name === 'page:title');
      assert.strictEqual(title?.signature, 'Studio App');
      assert.ok(analysis.dependencies.includes('/assets/style.css'));
      assert.ok(analysis.dependencies.includes('/js/main.js'));

      const domRoot = analysis.symbols.find(s => s.name === 'dom:#root');
      assert.ok(domRoot);
    });

    it('1.7 doit analyser un fichier CSS et extraire variables :root et classes', () => {
      const cssCode = `
        @import url('https://fonts.googleapis.com/css2?family=Inter');
        :root {
          --primary-color: #6366f1;
          --bg-dark: #0f172a;
        }
        .btn-primary {
          background-color: var(--primary-color);
        }
      `;

      const analysis = service.analyzeSource(cssCode, 'src/theme.css');
      assert.strictEqual(analysis.language, 'css');
      assert.strictEqual(analysis.analysisStatus, 'PARSED');

      const varPrimary = analysis.symbols.find(s => s.name === '--primary-color');
      assert.ok(varPrimary);
      const classBtn = analysis.symbols.find(s => s.name === '.btn-primary');
      assert.ok(classBtn);
      assert.ok(analysis.dependencies.includes('https://fonts.googleapis.com/css2?family=Inter'));
    });

    it('1.8 doit classer une extension non supportée en OPAQUE_BLOB sans crasher', () => {
      const rawData = 'BINARY_DATA_OPAQUE_STREAM';
      const analysis = service.analyzeSource(rawData, 'assets/logo.bin');
      assert.strictEqual(analysis.language, 'unknown');
      assert.strictEqual(analysis.analysisStatus, 'OPAQUE_BLOB');
      assert.ok(analysis.diagnostics.some(d => d.code === 'UNSUPPORTED_LANGUAGE'));
    });
  });

  describe('2. Extraction Structurelle Avancée (Imports, Exports, Enums, Routes)', () => {
    const service = new CodeIntelligenceService();

    it('2.1 doit extraire les imports nommés, namespace, et type-only', () => {
      const code = `
        import type { BaseConfig } from './config.js';
        import defaultRouter, { get, post } from 'express';
        import * as pathUtils from 'node:path';
      `;

      const analysis = service.analyzeSource(code, 'src/router.ts');
      assert.strictEqual(analysis.imports.length, 3);

      const typeImport = analysis.imports.find(i => i.moduleSpecifier === './config.js');
      assert.ok(typeImport);
      assert.strictEqual(typeImport?.isTypeOnly, true);
      assert.strictEqual(typeImport?.isRelative, true);

      const nsImport = analysis.imports.find(i => i.moduleSpecifier === 'node:path');
      assert.ok(nsImport);
      assert.strictEqual(nsImport?.namespaceImport, 'pathUtils');

      const expressImport = analysis.imports.find(i => i.moduleSpecifier === 'express');
      assert.ok(expressImport);
      assert.strictEqual(expressImport?.defaultImport, 'defaultRouter');
      assert.deepStrictEqual(expressImport?.namedImports, ['get', 'post']);
    });

    it('2.2 doit extraire les enums, type parameters et generics', () => {
      const code = `
        export enum ProjectStatus {
          ACTIVE = 'ACTIVE',
          ARCHIVED = 'ARCHIVED'
        }
        export interface Repository<T, ID> {
          findById(id: ID): T | null;
        }
      `;

      const analysis = service.analyzeSource(code, 'src/domain.ts');
      const enumSymbol = analysis.symbols.find(s => s.name === 'ProjectStatus');
      assert.ok(enumSymbol);
      assert.strictEqual(enumSymbol?.kind, 'enum');

      const iface = analysis.symbols.find(s => s.name === 'Repository');
      assert.ok(iface);
      assert.deepStrictEqual(iface?.typeParameters, ['T', 'ID']);
    });

    it('2.3 doit détecter statiquement les routes d API (app.get, router.post)', () => {
      const code = `
        app.get('/api/v1/users', (req, res) => res.json([]));
        router.post('/api/v1/auth/login', (req, res) => res.ok());
      `;

      const analysis = service.analyzeSource(code, 'src/api.ts');
      const routeGet = analysis.symbols.find(s => s.name === 'GET /api/v1/users');
      assert.ok(routeGet);
      assert.strictEqual(routeGet?.route?.method, 'GET');
      assert.strictEqual(routeGet?.route?.path, '/api/v1/users');
      assert.strictEqual(routeGet?.route?.confidence, 'CONFIRMED');

      const routePost = analysis.symbols.find(s => s.name === 'POST /api/v1/auth/login');
      assert.ok(routePost);
      assert.strictEqual(routePost?.route?.method, 'POST');
    });

    it('2.4 doit extraire les re-exports nommés et re-exports universels', () => {
      const code = `
        export { UserService } from './user-service.js';
        export * from './types.js';
      `;

      const analysis = service.analyzeSource(code, 'src/index.ts');
      assert.ok(analysis.exports.some(e => e.name === 'UserService' && e.sourceModule === './user-service.js'));
      assert.ok(analysis.exports.some(e => e.name === '*' && e.sourceModule === './types.js'));
      assert.ok(analysis.dependencies.includes('./user-service.js'));
      assert.ok(analysis.dependencies.includes('./types.js'));
    });
  });

  describe('3. Traitement des Erreurs & Code Invalide (PARSED_WITH_DIAGNOSTICS & OPAQUE_BLOB)', () => {
    const service = new CodeIntelligenceService();

    it('3.1 doit gérer le code TypeScript avec erreurs de syntaxe partielles via PARSED_WITH_DIAGNOSTICS', () => {
      // Syntaxe cassée dans la fonction calc, mais variable ok intacte
      const brokenTs = `
        export function brokenCalc(a, b) { return a + ; }
        export const intactConstant = 42;
      `;

      const analysis = service.analyzeSource(brokenTs, 'src/broken.ts');
      assert.strictEqual(analysis.analysisStatus, 'PARSED_WITH_DIAGNOSTICS');
      assert.ok(analysis.diagnostics.length > 0);

      const intact = analysis.symbols.find(s => s.name === 'intactConstant');
      assert.ok(intact);
      assert.strictEqual(intact?.kind, 'constant');
    });

    it('3.2 doit classer un fichier JSON corrompu en OPAQUE_BLOB avec diagnostic explicite', () => {
      const brokenJson = '{ "name": "app", "version": 1.0, }'; // virgule traînante invalide
      const analysis = service.analyzeSource(brokenJson, 'config.json');
      assert.strictEqual(analysis.analysisStatus, 'OPAQUE_BLOB');
      assert.ok(analysis.diagnostics.some(d => d.code === 'JSON_PARSE_ERROR'));
      assert.strictEqual(analysis.symbols.length, 0);
    });

    it('3.3 doit classer un fichier vide en EMPTY avec zéro diagnostic', () => {
      const emptyCode = '   \n\t  ';
      const analysis = service.analyzeSource(emptyCode, 'src/empty.ts');
      assert.strictEqual(analysis.analysisStatus, 'EMPTY');
      assert.strictEqual(analysis.symbols.length, 0);
      assert.strictEqual(analysis.diagnostics.length, 0);
    });

    it('3.4 doit classer un fichier dépassant la taille maximale en OPAQUE_BLOB avant parsing', () => {
      const miniService = new CodeIntelligenceService(undefined, { maxFileSizeBytes: 100 });
      const largeContent = 'export const big = "' + 'A'.repeat(200) + '";';

      const analysis = miniService.analyzeSource(largeContent, 'src/large.ts');
      assert.strictEqual(analysis.analysisStatus, 'OPAQUE_BLOB');
      assert.ok(analysis.diagnostics.some(d => d.code === 'FILE_TOO_LARGE'));
      assert.strictEqual(analysis.symbols.length, 0);
    });
  });

  describe('4. Déterminisme & Hachage Sémantique', () => {
    const service = new CodeIntelligenceService();

    it('4.1 doit produire un semanticHash strictement identique pour un contenu identique', () => {
      const code = `
        export const beta = 2;
        export const alpha = 1;
        import { c } from './c.js';
        import { b } from './b.js';
      `;

      const a1 = service.analyzeSource(code, 'src/order.ts', { fileHash: 'hash-xyz' });
      const a2 = service.analyzeSource(code, 'src/order.ts', { fileHash: 'hash-xyz' });

      assert.strictEqual(a1.semanticHash, a2.semanticHash);
      assert.strictEqual(a1.symbols[0]?.name, 'beta');
      assert.strictEqual(a1.symbols[1]?.name, 'alpha');
    });

    it('4.2 doit trier les symboles et imports de manière déterministe', () => {
      const code = `
        export function z() {}
        export function a() {}
        import { zed } from 'zed';
        import { abc } from 'abc';
      `;

      const analysis = service.analyzeSource(code, 'src/deterministic.ts');
      assert.strictEqual(analysis.imports[0]?.moduleSpecifier, 'abc');
      assert.strictEqual(analysis.imports[1]?.moduleSpecifier, 'zed');
    });
  });

  describe('5. Cache LRU & Immuabilité (Deep Freeze)', () => {
    it('5.1 doit enregistrer un cache miss puis un cache hit sur analyse identique', () => {
      const service = new CodeIntelligenceService();
      const code = 'export const value = 123;';

      const res1 = service.analyzeSource(code, 'src/val.ts', { fileHash: 'hash-1' });
      const m1 = service.getCacheMetrics();
      assert.strictEqual(m1.misses, 1);
      assert.strictEqual(m1.hits, 0);

      const res2 = service.analyzeSource(code, 'src/val.ts', { fileHash: 'hash-1' });
      const m2 = service.getCacheMetrics();
      assert.strictEqual(m2.misses, 1);
      assert.strictEqual(m2.hits, 1);
      assert.strictEqual(res1.semanticHash, res2.semanticHash);
    });

    it('5.2 doit invalider le cache lorsque le fileHash change', () => {
      const service = new CodeIntelligenceService();
      const code1 = 'export const value = 1;';
      const code2 = 'export const value = 2;';

      service.analyzeSource(code1, 'src/val.ts', { fileHash: 'hash-1' });
      service.analyzeSource(code2, 'src/val.ts', { fileHash: 'hash-2' });

      const metrics = service.getCacheMetrics();
      assert.strictEqual(metrics.misses, 2);
      assert.strictEqual(metrics.entryCount, 2);
    });

    it('5.3 doit respecter la capacité maximale et exécuter l éviction LRU', () => {
      const cache = new AnalysisLruCache(2);
      const fakeAnalysis = (name: string) => ({
        tenantId: 't1',
        projectId: 'p1',
        filePath: name,
        fileHash: 'h',
        language: 'typescript' as const,
        parser: 'test',
        analysisStatus: 'PARSED' as const,
        semanticHash: name,
        diagnostics: [],
        symbols: [],
        imports: [],
        exports: [],
        dependencies: [],
        lineCount: 1,
        sizeBytes: 10,
        executionMeta: { analyzedAt: 'now', durationMs: 0, analyzerVersion: '1' }
      });

      cache.set('k1', fakeAnalysis('f1'));
      cache.set('k2', fakeAnalysis('f2'));
      assert.strictEqual(cache.getMetrics().entryCount, 2);

      // Refresh k1 (now k2 is the oldest)
      cache.get('k1');

      // Add k3 -> k2 must be evicted
      cache.set('k3', fakeAnalysis('f3'));
      assert.strictEqual(cache.getMetrics().evictions, 1);
      assert.strictEqual(cache.get('k2'), null);
      assert.ok(cache.get('k1') !== null);
      assert.ok(cache.get('k3') !== null);
    });

    it('5.4 doit empêcher la mutation externe des objets en cache grâce à Deep Freeze', () => {
      const service = new CodeIntelligenceService();
      const code = 'export const x = 1;';
      const analysis = service.analyzeSource(code, 'src/freeze.ts');

      assert.ok(Object.isFrozen(analysis));
      assert.ok(Object.isFrozen(analysis.symbols));

      assert.throws(() => {
        (analysis.symbols as unknown as unknown[]).push({ name: 'hacked' });
      }, TypeError);
    });
  });

  describe('6. Isolation Multi-Tenant & RBAC', () => {
    it('6.1 doit isoler hermétiquement le cache entre tenant A et tenant B', () => {
      const service = new CodeIntelligenceService();
      const code = 'export const sharedCode = 100;';

      const aTenant1 = service.analyzeSource(code, 'src/index.ts', {
        tenantId: 'tenant-A',
        projectId: 'proj-1',
        fileHash: 'same-hash'
      });

      const aTenant2 = service.analyzeSource(code, 'src/index.ts', {
        tenantId: 'tenant-B',
        projectId: 'proj-1',
        fileHash: 'same-hash'
      });

      assert.strictEqual(service.getCacheMetrics().misses, 2);
      assert.strictEqual(aTenant1.tenantId, 'tenant-A');
      assert.strictEqual(aTenant2.tenantId, 'tenant-B');
    });

    it('6.2 doit autoriser le rôle VIEWER en lecture de fichier mais refuser sans tenantId ou projectId', () => {
      const fakeSource: IReadOnlyFileSource = {
        getFile: () => ({
          path: 'index.ts',
          name: 'index.ts',
          content: 'export const hello = "world";',
          sizeBytes: 30,
          updatedAt: new Date()
        }),
        getAllProjectFiles: () => ({ 'index.ts': 'export const hello = "world";' })
      };

      const service = new CodeIntelligenceService(fakeSource);

      assert.throws(() => {
        service.analyzeFile('', 'proj-1', 'index.ts', 'VIEWER');
      }, (err: unknown) => err instanceof Error && err.name === 'ValidationError');

      assert.throws(() => {
        service.analyzeFile('tenant-1', '', 'index.ts', 'VIEWER');
      }, (err: unknown) => err instanceof Error && err.name === 'ValidationError');

      const analysis = service.analyzeFile('tenant-1', 'proj-1', 'index.ts', 'VIEWER');
      assert.strictEqual(analysis.analysisStatus, 'PARSED');
    });
  });

  describe('7. Contrat Read-Only Strict & Analyse Projet Complet', () => {
    it('7.1 doit prouver qu aucune méthode de mutation de FileStore n est appelée', () => {
      let createNodeCalled = false;
      let saveFileCalled = false;
      let deleteNodeCalled = false;

      // Mock espionnant les méthodes interdites
      const spyStore = {
        getFile: () => ({
          path: 'app.ts',
          name: 'app.ts',
          content: 'export const safe = true;',
          sizeBytes: 25,
          updatedAt: new Date()
        }),
        getAllProjectFiles: () => ({
          'app.ts': 'export const safe = true;',
          'invalid.json': '{ bad: json }'
        }),
        createNode: () => { createNodeCalled = true; },
        saveFile: () => { saveFileCalled = true; },
        deleteNode: () => { deleteNodeCalled = true; }
      };

      const service = new CodeIntelligenceService(spyStore as unknown as IReadOnlyFileSource);
      const summary = service.analyzeProject('tenant-1', 'proj-1', 'VIEWER');

      assert.strictEqual(createNodeCalled, false);
      assert.strictEqual(saveFileCalled, false);
      assert.strictEqual(deleteNodeCalled, false);
      assert.strictEqual(summary.totalFiles, 2);
      assert.strictEqual(summary.parsedFiles, 1);
      assert.strictEqual(summary.opaqueFiles, 1);
      assert.ok(summary.fileAnalyses['app.ts']);
      assert.ok(summary.fileAnalyses['invalid.json']);
    });

    it('7.2 doit agréger correctement les globalExports et le dependencyGraph', () => {
      const files: Record<string, string> = {
        'src/utils.ts': 'export function helper() { return true; }',
        'src/main.ts': 'import { helper } from "./utils.js"; export const mainApp = true;'
      };

      const source: IReadOnlyFileSource = {
        getFile: (t, p, path) => files[path] ? {
          path,
          name: path,
          content: files[path],
          sizeBytes: files[path].length,
          updatedAt: new Date()
        } : null,
        getAllProjectFiles: () => files
      };

      const service = new CodeIntelligenceService(source);
      const projectSummary = service.analyzeProject('tenant-1', 'proj-1', 'VIEWER');

      assert.strictEqual(projectSummary.totalFiles, 2);
      assert.strictEqual(projectSummary.parsedFiles, 2);
      assert.ok(projectSummary.globalExports['src/utils.ts#helper']);
      assert.ok(projectSummary.globalExports['src/main.ts#mainApp']);
      assert.deepStrictEqual(projectSummary.dependencyGraph['src/main.ts'], ['./utils.js']);
    });
  });

});
