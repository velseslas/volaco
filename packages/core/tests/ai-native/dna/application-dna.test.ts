/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-002)
 * Application DNA Engine Unit and Integration Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApplicationDNAService,
  CodeIntelligenceService,
  DnaLruCache,
  ForbiddenError,
  ValidationError,
  type ApplicationDNA,
  type IReadOnlyFileSource,
  type ProjectAnalysisSummary
} from '../../../src/index.js';

class MockFileSource implements IReadOnlyFileSource {
  private files: Record<string, Record<string, Record<string, string>>> = {};

  public setFiles(tenantId: string, projectId: string, files: Record<string, string>): void {
    if (!this.files[tenantId]) {
      this.files[tenantId] = {};
    }
    this.files[tenantId]![projectId] = { ...files };
  }

  public getFile(tenantId: string, projectId: string, filePath: string) {
    const projectFiles = this.files[tenantId]?.[projectId];
    if (!projectFiles || !(filePath in projectFiles)) {
      return null;
    }
    const content = projectFiles[filePath]!;
    return {
      path: filePath,
      name: filePath.split('/').pop() || filePath,
      content,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      updatedAt: new Date()
    };
  }

  public getAllProjectFiles(tenantId: string, projectId: string): Record<string, string> {
    return { ...(this.files[tenantId]?.[projectId] ?? {}) };
  }
}

describe('AINT-002 : Application DNA Engine Unit & Integration Tests', () => {

  describe('1. Stack Detection (Evidence-based & Multi-layer)', () => {
    it('1.1 doit détecter React, Vite et TypeScript avec confiance CONFIRMED', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-spa', {
        'package.json': JSON.stringify({
          name: 'my-react-app',
          dependencies: {
            'react': '^18.2.0',
            'react-dom': '^18.2.0'
          },
          devDependencies: {
            'typescript': '^5.4.0',
            'vite': '^5.2.0'
          }
        }),
        'tsconfig.json': JSON.stringify({
          compilerOptions: { jsx: 'react-jsx' }
        }),
        'vite.config.ts': `import { defineConfig } from 'vite'; export default defineConfig({});`,
        'src/main.tsx': `
          import React from 'react';
          import ReactDOM from 'react-dom/client';
          import { App } from './App';
          ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
        `,
        'src/App.tsx': `
          import React, { useState } from 'react';
          export function App() {
            const [count, setCount] = useState(0);
            return <div><h1>Counter: {count}</h1></div>;
          }
        `
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-spa');

      assert.strictEqual(dna.stack.language.name, 'TypeScript');
      assert.strictEqual(dna.stack.language.confidence, 'CONFIRMED');

      assert.strictEqual(dna.stack.framework.name, 'React');
      assert.strictEqual(dna.stack.framework.confidence, 'CONFIRMED');

      assert.ok(dna.stack.uiLibrary);
      assert.strictEqual(dna.stack.uiLibrary?.name, 'React');
      assert.strictEqual(dna.stack.uiLibrary?.confidence, 'CONFIRMED');

      assert.ok(dna.stack.buildTool);
      assert.strictEqual(dna.stack.buildTool?.name, 'Vite');
      assert.strictEqual(dna.stack.buildTool?.confidence, 'CONFIRMED');
    });

    it('1.2 doit détecter Fastify Backend REST API avec dépendances et imports AST', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-api', {
        'package.json': JSON.stringify({
          name: 'my-backend-api',
          dependencies: {
            'fastify': '^4.26.0'
          }
        }),
        'src/server.ts': `
          import fastify from 'fastify';
          const app = fastify();
          app.get('/health', async (req, reply) => {
            return { status: 'ok' };
          });
          app.listen({ port: 3000 });
        `
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-api');

      assert.strictEqual(dna.stack.framework.name, 'Fastify');
      assert.strictEqual(dna.stack.framework.confidence, 'CONFIRMED');
      assert.strictEqual(dna.stack.runtime.name, 'Node.js');
    });

    it('1.3 doit détecter Next.js Fullstack avec config et dépendances', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-next', {
        'package.json': JSON.stringify({
          name: 'next-portal',
          dependencies: {
            'next': '^14.1.0',
            'react': '^18.2.0',
            'react-dom': '^18.2.0'
          }
        }),
        'next.config.js': 'module.exports = {};',
        'app/page.tsx': `
          export default function Page() {
            return <main><h1>Next.js Portal</h1></main>;
          }
        `
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-next');

      assert.strictEqual(dna.stack.framework.name, 'Next.js');
      assert.strictEqual(dna.stack.framework.confidence, 'CONFIRMED');
      assert.ok(dna.stack.uiLibrary);
      assert.strictEqual(dna.stack.uiLibrary?.name, 'React');
    });

    it('1.4 doit détecter Prisma ORM et PostgreSQL Driver', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-db', {
        'package.json': JSON.stringify({
          name: 'db-service',
          dependencies: {
            '@prisma/client': '^5.10.0',
            'pg': '^8.11.0'
          },
          devDependencies: {
            'prisma': '^5.10.0'
          }
        }),
        'prisma/schema.prisma': `
          datasource db {
            provider = "postgresql"
            url      = env("DATABASE_URL")
          }
        `,
        'src/db.ts': `
          import { PrismaClient } from '@prisma/client';
          export const prisma = new PrismaClient();
        `
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-db');

      assert.ok(dna.stack.databaseOrOrm);
      assert.strictEqual(dna.stack.databaseOrOrm?.name, 'Prisma');
      assert.strictEqual(dna.stack.databaseOrOrm?.confidence, 'CONFIRMED');

      const pgTech = dna.stack.additionalTechnologies.find(t => t.name === 'PostgreSQL Driver');
      assert.ok(pgTech);
      assert.strictEqual(pgTech?.confidence, 'CONFIRMED');
    });

    it('1.5 doit inférer React (INFERRED) à partir de composants JSX sans package.json', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-infer', {
        'src/Button.tsx': `
          export function Button(props: { label: string }) {
            return <button>{props.label}</button>;
          }
        `
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-infer');

      assert.strictEqual(dna.stack.language.name, 'TypeScript');
      assert.strictEqual(dna.stack.framework.name, 'React');
      assert.strictEqual(dna.stack.framework.confidence, 'INFERRED');
    });

    it('1.6 doit identifier une stack UNKNOWN sur un projet vide sans inventer de technologie', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-empty', {});

      const dna = dnaService.extractDNA('tenant-1', 'proj-empty');

      assert.strictEqual(dna.stack.language.name, 'unknown');
      assert.strictEqual(dna.stack.language.confidence, 'UNKNOWN');
      assert.strictEqual(dna.stack.framework.name, 'unknown');
      assert.strictEqual(dna.stack.framework.confidence, 'UNKNOWN');
      assert.strictEqual(dna.stack.runtime.name, 'unknown');
      assert.strictEqual(dna.stack.runtime.confidence, 'UNKNOWN');
      assert.strictEqual(dna.stack.additionalTechnologies.length, 0);
    });
  });

  describe('2. Architecture & Layer Classification', () => {
    it('2.1 doit partitionner les fichiers dans les couches architecturales exactes', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-layered', {
        'package.json': JSON.stringify({ name: 'full-app' }),
        'tsconfig.json': JSON.stringify({}),
        'src/components/Card.tsx': 'export function Card() { return <div>Card</div>; }',
        'src/server.ts': `
          import fastify from 'fastify';
          const app = fastify();
          app.listen({ port: 3000 });
        `,
        'src/routes/users.ts': `
          import fastify from 'fastify';
          const app = fastify();
          app.get('/users', async () => []);
        `,
        'src/types/user.ts': 'export interface User { id: string; name: string; }',
        'src/utils/math.ts': 'export function add(a: number, b: number) { return a + b; }',
        'src/db/repository.ts': 'export class UserRepository {}',
        'tests/unit.test.ts': 'describe("test", () => {});',
        'public/logo.svg': '<svg></svg>'
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-layered');
      const layerNames = dna.architecture.layers.map(l => l.kind);

      assert.ok(layerNames.includes('frontend'));
      assert.ok(layerNames.includes('backend'));
      assert.ok(layerNames.includes('api_routes'));
      assert.ok(layerNames.includes('domain_models'));
      assert.ok(layerNames.includes('shared_utils'));
      assert.ok(layerNames.includes('data_access'));
      assert.ok(layerNames.includes('config'));
      assert.ok(layerNames.includes('tests'));
      assert.ok(layerNames.includes('assets'));
    });

    it('2.2 doit identifier les points d entrée client et serveur', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-entries', {
        'package.json': '{}',
        'src/main.tsx': 'export function App() { return <div>App</div>; }',
        'src/server.ts': `
          import express from 'express';
          const app = express();
          app.listen(8080);
        `
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-entries');
      const clientEntry = dna.architecture.entryPoints.find(ep => ep.role === 'client_entry');
      const serverEntry = dna.architecture.entryPoints.find(ep => ep.role === 'server_entry');

      assert.ok(clientEntry);
      assert.strictEqual(clientEntry?.path, 'src/main.tsx');
      assert.ok(serverEntry);
      assert.strictEqual(serverEntry?.path, 'src/server.ts');
    });

    it('2.3 doit classifier le pattern SPA sur projet React frontend pur', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-spa-pattern', {
        'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
        'src/App.tsx': 'export function App() { return <div>Hello SPA</div>; }'
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-spa-pattern');
      assert.strictEqual(dna.architecture.primaryPattern.pattern, 'SPA');
      assert.strictEqual(dna.architecture.primaryPattern.confidence, 'CONFIRMED');
    });

    it('2.4 doit classifier le pattern MONOLITH quand frontend et backend coexistent', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-monolith', {
        'package.json': JSON.stringify({ dependencies: { react: '^18.0.0', fastify: '^4.0.0' } }),
        'src/App.tsx': 'export function App() { return <div>Client UI</div>; }',
        'src/server.ts': 'import fastify from "fastify"; const app = fastify();'
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-monolith');
      assert.strictEqual(dna.architecture.primaryPattern.pattern, 'MONOLITH');
    });

    it('2.5 doit classifier le pattern REST_API sur un backend autonome avec routes', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-rest', {
        'package.json': JSON.stringify({ dependencies: { express: '^4.18.0' } }),
        'src/server.ts': `
          import express from 'express';
          const app = express();
          app.get('/api/items', (req, res) => res.json([]));
          app.post('/api/items', (req, res) => res.json({}));
        `
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-rest');
      assert.strictEqual(dna.architecture.primaryPattern.pattern, 'REST_API');
      assert.strictEqual(dna.architecture.routesCount, 2);
    });
  });

  describe('3. Components & Module Boundaries', () => {
    it('3.1 doit extraire les ComponentProfile avec décompte exact des props et hooks', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-comp', {
        'src/components/UserProfile.tsx': `
          import React, { useState, useEffect } from 'react';
          export function UserProfile({ userId, showDetails, onSave }: { userId: string; showDetails: boolean; onSave: () => void }) {
            const [user, setUser] = useState(null);
            useEffect(() => {}, []);
            return <div>User: {userId}</div>;
          }
        `
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-comp');
      assert.strictEqual(dna.components.length, 1);

      const comp = dna.components[0]!;
      assert.strictEqual(comp.name, 'UserProfile');
      assert.strictEqual(comp.filePath, 'src/components/UserProfile.tsx');
      assert.strictEqual(comp.propsCount, 3);
      assert.ok(comp.hooksUsed.includes('useState'));
      assert.ok(comp.hooksUsed.includes('useEffect'));
      assert.strictEqual(comp.classification, 'COMPONENT_CONFIRMED');
    });

    it('3.2 doit extraire les ModuleBoundary avec exports publics et dépendances externes', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-mod', {
        'src/features/auth/index.ts': `
          export { loginUser } from './login.js';
        `,
        'src/features/auth/login.ts': `
          import { httpPost } from '../../utils/http.js';
          export function loginUser() { return httpPost('/login'); }
        `,
        'src/utils/http.ts': `
          export function httpPost(url: string) { return url; }
        `
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-mod');
      const authMod = dna.modules.find(m => m.name === 'auth' || m.rootPath === 'src/features/auth');

      assert.ok(authMod);
      assert.strictEqual(authMod?.files.length, 2);
      assert.ok(authMod?.files.includes('src/features/auth/index.ts'));
      assert.ok(authMod?.files.includes('src/features/auth/login.ts'));
      assert.ok(authMod?.publicExports.includes('loginUser'));
    });

    it('3.3 doit garantir le tri canonique des composants et modules', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-sort', {
        'src/components/Zebra.tsx': 'export function Zebra() { return <div>Z</div>; }',
        'src/components/Alpha.tsx': 'export function Alpha() { return <div>A</div>; }',
        'src/components/Beta.tsx': 'export function Beta() { return <div>B</div>; }'
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-sort');
      const compNames = dna.components.map(c => c.name);

      assert.deepStrictEqual(compNames, ['Alpha', 'Beta', 'Zebra']);
    });
  });

  describe('4. Dependency Graph, Topological Sort & Cycle Detection', () => {
    it('4.1 doit calculer les directDependencies et reverseDependencies', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-graph', {
        'src/a.ts': `import { b } from './b.js'; export const a = b;`,
        'src/b.ts': `import { c } from './c.js'; export const b = c;`,
        'src/c.ts': `export const c = 42;`
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-graph');
      const gm = dna.graphMetrics;

      assert.strictEqual(gm.nodeCount, 3);
      assert.deepStrictEqual(gm.directDependencies['src/a.ts'], ['src/b.ts']);
      assert.deepStrictEqual(gm.directDependencies['src/b.ts'], ['src/c.ts']);
      assert.deepStrictEqual(gm.directDependencies['src/c.ts'], []);

      assert.deepStrictEqual(gm.reverseDependencies['src/c.ts'], ['src/b.ts']);
      assert.deepStrictEqual(gm.reverseDependencies['src/b.ts'], ['src/a.ts']);
      assert.deepStrictEqual(gm.reverseDependencies['src/a.ts'], []);
    });

    it('4.2 doit identifier les fichiers isolés', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-iso', {
        'src/connected1.ts': `import { connected2 } from './connected2.js';`,
        'src/connected2.ts': `export const connected2 = 1;`,
        'src/standalone.ts': `export const PI = 3.14159;`
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-iso');
      assert.deepStrictEqual(dna.graphMetrics.isolatedFiles, ['src/standalone.ts']);
    });

    it('4.3 doit classer les fichiers les plus dépendus (mostDependedOnFiles)', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-centrality', {
        'src/core.ts': `export const CORE = 'engine';`,
        'src/client1.ts': `import { CORE } from './core.js';`,
        'src/client2.ts': `import { CORE } from './core.js';`,
        'src/client3.ts': `import { CORE } from './core.js';`
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-centrality');
      const most = dna.graphMetrics.mostDependedOnFiles[0];

      assert.ok(most);
      assert.strictEqual(most?.path, 'src/core.ts');
      assert.strictEqual(most?.dependentsCount, 3);
    });

    it('4.4 doit calculer un ordre topologique valide (dependencies-first)', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-topo', {
        'src/app.ts': `import { service } from './service.js';`,
        'src/service.ts': `import { db } from './db.js'; export const service = db;`,
        'src/db.ts': `export const db = 'connection';`
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-topo');
      const order = dna.graphMetrics.topologicalOrder;

      // db must come before service, and service before app
      const dbIdx = order.indexOf('src/db.ts');
      const srvIdx = order.indexOf('src/service.ts');
      const appIdx = order.indexOf('src/app.ts');

      assert.ok(dbIdx < srvIdx, `db (${dbIdx}) should come before service (${srvIdx})`);
      assert.ok(srvIdx < appIdx, `service (${srvIdx}) should come before app (${appIdx})`);
    });

    it('4.5 doit détecter formellement les dépendances circulaires sans boucle infinie', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-cycle', {
        'src/cycleA.ts': `import { b } from './cycleB.js'; export const a = 1;`,
        'src/cycleB.ts': `import { a } from './cycleA.js'; export const b = 2;`
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-cycle');
      const cycles = dna.graphMetrics.circularDependencies;

      assert.strictEqual(cycles.length, 1);
      assert.ok(cycles[0]!.includes('src/cycleA.ts'));
      assert.ok(cycles[0]!.includes('src/cycleB.ts'));
      assert.strictEqual(dna.summary.overallHealth, 'WARNINGS');
    });
  });

  describe('5. Confidence & Provenance Model (DNAEvidence)', () => {
    it('5.1 doit consigner des preuves DNAEvidence avec kind, path, et detail pour chaque techno', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-evidence', {
        'package.json': JSON.stringify({
          dependencies: { fastify: '^4.20.0' }
        })
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-evidence');
      const fw = dna.stack.framework;

      assert.strictEqual(fw.name, 'Fastify');
      assert.strictEqual(fw.confidence, 'CONFIRMED');
      assert.ok(fw.evidence.length > 0);

      const ev = fw.evidence[0]!;
      assert.strictEqual(ev.kind, 'PACKAGE_DEPENDENCY');
      assert.strictEqual(ev.path, 'package.json');
      assert.ok(ev.detail.includes('fastify'));
      assert.strictEqual(ev.confidence, 'CONFIRMED');
    });

    it('5.2 doit fournir des numéros de ligne pour les preuves issues d imports AST', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-ast-ev', {
        'src/server.ts': `// line 1\n// line 2\nimport fastify from 'fastify';\nconst app = fastify();`
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-ast-ev');
      const fw = dna.stack.framework;

      assert.strictEqual(fw.name, 'Fastify');
      const astEv = fw.evidence.find(e => e.kind === 'AST_IMPORT');
      assert.ok(astEv);
      assert.strictEqual(astEv?.path, 'src/server.ts');
      assert.strictEqual(astEv?.line, 3);
    });

    it('5.3 doit respecter rigoureusement l échelle de confiance (CONFIRMED vs INFERRED vs UNKNOWN)', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-conf', {
        'src/component.tsx': `export function Comp() { return <span>Infer</span>; }`
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-conf');

      assert.strictEqual(dna.stack.language.confidence, 'INFERRED'); // .tsx file without tsconfig/package.json
      assert.strictEqual(dna.stack.framework.confidence, 'INFERRED'); // React inferred without package.json
      assert.strictEqual(dna.stack.testFramework, undefined);
    });
  });

  describe('6. Determinism & Immutability', () => {
    it('6.1 doit produire exactement le même dnaHash sur 10 exécutions consécutives', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-det', {
        'package.json': JSON.stringify({ name: 'det-test', dependencies: { react: '^18.0.0' } }),
        'src/index.tsx': 'export const App = () => <div>Deterministic</div>;'
      });

      const hashes: string[] = [];
      for (let i = 0; i < 10; i++) {
        dnaService.clearCache();
        const dna = dnaService.extractDNA('tenant-1', 'proj-det');
        hashes.push(dna.dnaHash);
      }

      const firstHash = hashes[0]!;
      assert.ok(firstHash.length === 64, 'SHA-256 hash must be 64 hex chars');
      for (const h of hashes) {
        assert.strictEqual(h, firstHash);
      }
    });

    it('6.2 doit produire le même dnaHash quel que soit l ordre des fichiers dans le projet', () => {
      const mockSource1 = new MockFileSource();
      const codeIntel1 = new CodeIntelligenceService(mockSource1);
      const dnaService1 = new ApplicationDNAService(codeIntel1);

      mockSource1.setFiles('tenant-1', 'proj-order', {
        'src/z.ts': 'export const z = 1;',
        'src/a.ts': 'export const a = 2;',
        'package.json': '{"name":"test"}'
      });

      const mockSource2 = new MockFileSource();
      const codeIntel2 = new CodeIntelligenceService(mockSource2);
      const dnaService2 = new ApplicationDNAService(codeIntel2);

      mockSource2.setFiles('tenant-1', 'proj-order', {
        'package.json': '{"name":"test"}',
        'src/a.ts': 'export const a = 2;',
        'src/z.ts': 'export const z = 1;'
      });

      const dna1 = dnaService1.extractDNA('tenant-1', 'proj-order');
      const dna2 = dnaService2.extractDNA('tenant-1', 'proj-order');

      assert.strictEqual(dna1.dnaHash, dna2.dnaHash);
    });

    it('6.3 doit exclure extractedAt et durationMs du calcul du dnaHash', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-stable', {
        'src/file.ts': 'export const val = 123;'
      });

      const dna1 = dnaService.extractDNA('tenant-1', 'proj-stable');
      dnaService.clearCache();
      const dna2 = dnaService.extractDNA('tenant-1', 'proj-stable');

      assert.strictEqual(dna1.dnaHash, dna2.dnaHash);
    });

    it('6.4 doit geler profondément l objet ApplicationDNA retourné (deepFreeze)', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-freeze', {
        'src/file.ts': 'export const frozen = true;'
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-freeze');

      assert.ok(Object.isFrozen(dna));
      assert.ok(Object.isFrozen(dna.stack));
      assert.ok(Object.isFrozen(dna.architecture));
      assert.ok(Object.isFrozen(dna.graphMetrics));

      assert.throws(() => {
        (dna as unknown as Record<string, unknown>).projectId = 'hacked';
      }, TypeError);

      assert.throws(() => {
        (dna.summary as unknown as Record<string, unknown>).totalFiles = 999;
      }, TypeError);
    });
  });

  describe('7. Cache Strategy, Invalidation & LRU Eviction', () => {
    it('7.1 doit retourner le résultat en cache (cache hit) lors d un deuxième appel identique', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-cache', {
        'src/main.ts': 'export const v = 1;'
      });

      const dna1 = dnaService.extractDNA('tenant-1', 'proj-cache');
      let metrics = dnaService.getCacheMetrics();
      assert.strictEqual(metrics.hits, 0);
      assert.strictEqual(metrics.misses, 1);

      const dna2 = dnaService.extractDNA('tenant-1', 'proj-cache');
      metrics = dnaService.getCacheMetrics();
      assert.strictEqual(metrics.hits, 1);
      assert.strictEqual(metrics.misses, 1);

      assert.strictEqual(dna1, dna2); // Exact reference from cache
    });

    it('7.2 doit invalider le cache dès que le treeHash du projet change', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-inv', {
        'src/main.ts': 'export const v = 1;'
      });

      const dna1 = dnaService.extractDNA('tenant-1', 'proj-inv');

      // Modify file content -> treeHash changes
      mockSource.setFiles('tenant-1', 'proj-inv', {
        'src/main.ts': 'export const v = 2;'
      });

      const dna2 = dnaService.extractDNA('tenant-1', 'proj-inv');
      const metrics = dnaService.getCacheMetrics();

      assert.strictEqual(metrics.misses, 2);
      assert.notStrictEqual(dna1.treeHash, dna2.treeHash);
      assert.notStrictEqual(dna1.dnaHash, dna2.dnaHash);
    });

    it('7.3 doit respecter la capacité maximale du cache et expulser selon LRU', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel, { cacheMaxEntries: 2 });

      mockSource.setFiles('tenant-1', 'proj-1', { 'a.ts': 'export const a = 1;' });
      mockSource.setFiles('tenant-1', 'proj-2', { 'b.ts': 'export const b = 2;' });
      mockSource.setFiles('tenant-1', 'proj-3', { 'c.ts': 'export const c = 3;' });

      dnaService.extractDNA('tenant-1', 'proj-1');
      dnaService.extractDNA('tenant-1', 'proj-2');
      dnaService.extractDNA('tenant-1', 'proj-3'); // Should evict proj-1

      const metrics = dnaService.getCacheMetrics();
      assert.strictEqual(metrics.entryCount, 2);
      assert.strictEqual(metrics.evictions, 1);
    });

    it('7.4 doit réinitialiser le cache et les compteurs via clearCache()', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-clear', { 'src/a.ts': 'export const a = 1;' });
      dnaService.extractDNA('tenant-1', 'proj-clear');

      assert.strictEqual(dnaService.getCacheMetrics().entryCount, 1);
      dnaService.clearCache();

      const metrics = dnaService.getCacheMetrics();
      assert.strictEqual(metrics.entryCount, 0);
      assert.strictEqual(metrics.hits, 0);
      assert.strictEqual(metrics.misses, 0);
    });
  });

  describe('8. Multi-Tenancy & RBAC Security Boundaries', () => {
    it('8.1 doit isoler hermétiquement les données et caches entre deux locataires distincts', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-alpha', 'proj-shared-id', {
        'package.json': JSON.stringify({ name: 'alpha-app', dependencies: { react: '^18.0.0' } })
      });

      mockSource.setFiles('tenant-beta', 'proj-shared-id', {
        'package.json': JSON.stringify({ name: 'beta-app', dependencies: { fastify: '^4.0.0' } })
      });

      const dnaAlpha = dnaService.extractDNA('tenant-alpha', 'proj-shared-id');
      const dnaBeta = dnaService.extractDNA('tenant-beta', 'proj-shared-id');

      assert.strictEqual(dnaAlpha.stack.framework.name, 'React');
      assert.strictEqual(dnaBeta.stack.framework.name, 'Fastify');
      assert.notStrictEqual(dnaAlpha.dnaHash, dnaBeta.dnaHash);
    });

    it('8.2 doit rejeter les requêtes sans tenantId ou projectId avec ValidationError', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      assert.throws(() => {
        dnaService.extractDNA('', 'proj-id');
      }, ValidationError);

      assert.throws(() => {
        dnaService.extractDNA('tenant-id', '');
      }, ValidationError);
    });

    it('8.3 doit faire respecter les permissions RBAC et accepter VIEWER', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-rbac', {
        'src/main.ts': 'export const ready = true;'
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-rbac', 'VIEWER');
      assert.ok(dna);
      assert.strictEqual(dna.projectId, 'proj-rbac');
    });
  });

  describe('9. Degraded States & Resilience', () => {
    it('9.1 doit traiter avec grâce un projet vide sans crash (health: DEGRADED)', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-zero', {});

      const dna = dnaService.extractDNA('tenant-1', 'proj-zero');

      assert.strictEqual(dna.summary.totalFiles, 0);
      assert.strictEqual(dna.summary.overallHealth, 'DEGRADED');
      assert.strictEqual(dna.architecture.primaryPattern.pattern, 'UNKNOWN');
      assert.strictEqual(dna.components.length, 0);
      assert.strictEqual(dna.modules.length, 0);
      assert.strictEqual(dna.graphMetrics.nodeCount, 0);
    });

    it('9.2 doit basculer l état de santé sur WARNINGS en présence de diagnostics ou de cycles', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-warn', {
        'src/invalid.json': '{ bad json content here'
      });

      const dna = dnaService.extractDNA('tenant-1', 'proj-warn');

      assert.strictEqual(dna.summary.overallHealth, 'WARNINGS');
      assert.ok(dna.summary.diagnosticsCount > 0);
    });
  });

  describe('10. End-to-End Method extractFromSummary', () => {
    it('10.1 doit pouvoir extraire le DNA directement à partir d un ProjectAnalysisSummary préexistant', () => {
      const mockSource = new MockFileSource();
      const codeIntel = new CodeIntelligenceService(mockSource);
      const dnaService = new ApplicationDNAService(codeIntel);

      mockSource.setFiles('tenant-1', 'proj-preanalyzed', {
        'package.json': JSON.stringify({ dependencies: { vue: '^3.0.0' } }),
        'src/App.vue': '<template><div>Vue</div></template>'
      });

      const summary = codeIntel.analyzeProject('tenant-1', 'proj-preanalyzed');
      const dna = dnaService.extractFromSummary(summary);

      assert.ok(dna);
      assert.strictEqual(dna.tenantId, 'tenant-1');
      assert.strictEqual(dna.projectId, 'proj-preanalyzed');
      assert.strictEqual(dna.stack.framework.name, 'Vue');
    });
  });
});
