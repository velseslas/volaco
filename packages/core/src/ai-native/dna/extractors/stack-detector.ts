/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-002)
 * Stack Detector (Multi-layer evidence-based technology detection)
 */

import type { ProjectAnalysisSummary, FileAnalysis } from '../../understanding/types.js';
import type {
  ApplicationStack,
  DetectedTechnology,
  DNAConfidence,
  DNAEvidence,
  TechnologyCategory
} from '../types.js';
import { canonicalSort } from './base.js';

interface TechRule {
  name: string;
  category: TechnologyCategory;
  packageNames?: readonly string[];
  configFiles?: readonly string[];
  importModules?: readonly string[];
  fileExtensions?: readonly string[];
  symbolPrefixes?: readonly string[];
}

const TECH_RULES: readonly TechRule[] = [
  // Languages
  {
    name: 'TypeScript',
    category: 'language',
    packageNames: ['typescript'],
    configFiles: ['tsconfig.json'],
    fileExtensions: ['.ts', '.tsx', '.mts', '.cts']
  },
  {
    name: 'JavaScript',
    category: 'language',
    fileExtensions: ['.js', '.jsx', '.mjs', '.cjs']
  },

  // Frontend / Fullstack Frameworks
  {
    name: 'React',
    category: 'ui',
    packageNames: ['react', 'react-dom'],
    importModules: ['react', 'react-dom']
  },
  {
    name: 'Next.js',
    category: 'framework',
    packageNames: ['next'],
    configFiles: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
    importModules: ['next', 'next/router', 'next/navigation', 'next/server']
  },
  {
    name: 'Vue',
    category: 'ui',
    packageNames: ['vue'],
    configFiles: ['vue.config.js'],
    importModules: ['vue'],
    fileExtensions: ['.vue']
  },
  {
    name: 'Svelte',
    category: 'ui',
    packageNames: ['svelte', '@sveltejs/kit'],
    configFiles: ['svelte.config.js'],
    importModules: ['svelte'],
    fileExtensions: ['.svelte']
  },
  {
    name: 'Angular',
    category: 'ui',
    packageNames: ['@angular/core'],
    configFiles: ['angular.json'],
    importModules: ['@angular/core']
  },
  {
    name: 'Astro',
    category: 'framework',
    packageNames: ['astro'],
    configFiles: ['astro.config.mjs'],
    importModules: ['astro'],
    fileExtensions: ['.astro']
  },

  // Backend Frameworks
  {
    name: 'Fastify',
    category: 'framework',
    packageNames: ['fastify'],
    importModules: ['fastify']
  },
  {
    name: 'Express',
    category: 'framework',
    packageNames: ['express'],
    importModules: ['express']
  },
  {
    name: 'NestJS',
    category: 'framework',
    packageNames: ['@nestjs/core'],
    configFiles: ['nest-cli.json'],
    importModules: ['@nestjs/core', '@nestjs/common']
  },
  {
    name: 'Hono',
    category: 'framework',
    packageNames: ['hono'],
    importModules: ['hono']
  },
  {
    name: 'Koa',
    category: 'framework',
    packageNames: ['koa'],
    importModules: ['koa']
  },

  // Runtimes
  {
    name: 'Node.js',
    category: 'runtime',
    packageNames: ['@types/node'],
    importModules: ['node:fs', 'node:path', 'node:crypto', 'node:http', 'node:test', 'fs', 'path', 'crypto', 'http']
  },
  {
    name: 'Bun',
    category: 'runtime',
    packageNames: ['@types/bun', 'bun-types'],
    configFiles: ['bunfig.toml'],
    importModules: ['bun', 'bun:test']
  },
  {
    name: 'Deno',
    category: 'runtime',
    configFiles: ['deno.json', 'deno.jsonc']
  },

  // State Management
  {
    name: 'Redux',
    category: 'state',
    packageNames: ['@reduxjs/toolkit', 'redux', 'react-redux'],
    importModules: ['@reduxjs/toolkit', 'redux', 'react-redux']
  },
  {
    name: 'Zustand',
    category: 'state',
    packageNames: ['zustand'],
    importModules: ['zustand']
  },
  {
    name: 'Pinia',
    category: 'state',
    packageNames: ['pinia'],
    importModules: ['pinia']
  },
  {
    name: 'MobX',
    category: 'state',
    packageNames: ['mobx', 'mobx-react-lite'],
    importModules: ['mobx', 'mobx-react-lite']
  },
  {
    name: 'Vuex',
    category: 'state',
    packageNames: ['vuex'],
    importModules: ['vuex']
  },
  {
    name: 'Recoil',
    category: 'state',
    packageNames: ['recoil'],
    importModules: ['recoil']
  },

  // Database / ORM
  {
    name: 'Prisma',
    category: 'orm',
    packageNames: ['@prisma/client', 'prisma'],
    configFiles: ['prisma/schema.prisma', 'schema.prisma'],
    importModules: ['@prisma/client']
  },
  {
    name: 'Drizzle',
    category: 'orm',
    packageNames: ['drizzle-orm', 'drizzle-kit'],
    configFiles: ['drizzle.config.ts', 'drizzle.config.js'],
    importModules: ['drizzle-orm']
  },
  {
    name: 'TypeORM',
    category: 'orm',
    packageNames: ['typeorm'],
    configFiles: ['ormconfig.json'],
    importModules: ['typeorm']
  },
  {
    name: 'Mongoose',
    category: 'orm',
    packageNames: ['mongoose'],
    importModules: ['mongoose']
  },
  {
    name: 'Kysely',
    category: 'orm',
    packageNames: ['kysely'],
    importModules: ['kysely']
  },
  {
    name: 'Sequelize',
    category: 'orm',
    packageNames: ['sequelize'],
    importModules: ['sequelize']
  },
  {
    name: 'PostgreSQL Driver',
    category: 'database',
    packageNames: ['pg', '@types/pg'],
    importModules: ['pg']
  },
  {
    name: 'MySQL Driver',
    category: 'database',
    packageNames: ['mysql2'],
    importModules: ['mysql2']
  },

  // Testing
  {
    name: 'Vitest',
    category: 'testing',
    packageNames: ['vitest'],
    configFiles: ['vitest.config.ts', 'vitest.config.js'],
    importModules: ['vitest']
  },
  {
    name: 'Jest',
    category: 'testing',
    packageNames: ['jest', '@types/jest'],
    configFiles: ['jest.config.js', 'jest.config.ts'],
    importModules: ['jest']
  },
  {
    name: 'Playwright',
    category: 'testing',
    packageNames: ['@playwright/test'],
    configFiles: ['playwright.config.ts'],
    importModules: ['@playwright/test']
  },
  {
    name: 'Cypress',
    category: 'testing',
    packageNames: ['cypress'],
    configFiles: ['cypress.config.ts', 'cypress.config.js'],
    importModules: ['cypress']
  },
  {
    name: 'node:test',
    category: 'testing',
    importModules: ['node:test']
  },

  // Build Tools / Bundlers
  {
    name: 'Vite',
    category: 'build_tool',
    packageNames: ['vite'],
    configFiles: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'],
    importModules: ['vite']
  },
  {
    name: 'Webpack',
    category: 'build_tool',
    packageNames: ['webpack'],
    configFiles: ['webpack.config.js', 'webpack.config.ts'],
    importModules: ['webpack']
  },
  {
    name: 'Esbuild',
    category: 'build_tool',
    packageNames: ['esbuild'],
    importModules: ['esbuild']
  },
  {
    name: 'Rollup',
    category: 'build_tool',
    packageNames: ['rollup'],
    configFiles: ['rollup.config.js'],
    importModules: ['rollup']
  },
  {
    name: 'Turbopack',
    category: 'build_tool',
    packageNames: ['@vercel/turbopack']
  },
  {
    name: 'Tsup',
    category: 'build_tool',
    packageNames: ['tsup'],
    configFiles: ['tsup.config.ts', 'tsup.config.js']
  },

  // Styling
  {
    name: 'Tailwind CSS',
    category: 'styling',
    packageNames: ['tailwindcss'],
    configFiles: ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs'],
    importModules: ['tailwindcss']
  },
  {
    name: 'Styled Components',
    category: 'styling',
    packageNames: ['styled-components'],
    importModules: ['styled-components']
  },
  {
    name: 'Emotion',
    category: 'styling',
    packageNames: ['@emotion/react', '@emotion/styled'],
    importModules: ['@emotion/react', '@emotion/styled']
  },
  {
    name: 'Sass/SCSS',
    category: 'styling',
    packageNames: ['sass', 'node-sass'],
    fileExtensions: ['.scss', '.sass']
  }
];

export class StackDetector {
  public detect(summary: ProjectAnalysisSummary): ApplicationStack {
    const fileAnalyses = summary.fileAnalyses;
    const allPaths = Object.keys(fileAnalyses);

    // 1. Gather package.json dependencies and versions
    const packageDeps = new Map<string, { version?: string | undefined; filePath: string }>();
    for (const [p, fa] of Object.entries(fileAnalyses)) {
      if (p.toLowerCase().endsWith('package.json')) {
        for (const dep of fa.dependencies) {
          // Look for version signature in symbols
          let ver: string | undefined = undefined;
          for (const s of fa.symbols) {
            if (s.name === `dependencies:${dep}` || s.name === `devDependencies:${dep}` || s.name === `peerDependencies:${dep}`) {
              if (s.signature && s.signature.includes('@')) {
                ver = s.signature.split('@')[1];
              }
            }
          }
          packageDeps.set(dep, { version: ver, filePath: p });
        }
      }
    }

    // 2. Gather AST imports across all files
    const allImports = new Map<string, { filePath: string; line: number }[]>();
    for (const [p, fa] of Object.entries(fileAnalyses)) {
      for (const imp of fa.imports) {
        const mod = imp.moduleSpecifier;
        const list = allImports.get(mod) ?? [];
        list.push({ filePath: p, line: imp.line });
        allImports.set(mod, list);
      }
    }

    // 3. Count extensions
    const extensionCounts = new Map<string, string[]>();
    for (const p of allPaths) {
      const idx = p.lastIndexOf('.');
      if (idx !== -1) {
        const ext = p.substring(idx).toLowerCase();
        const list = extensionCounts.get(ext) ?? [];
        list.push(p);
        extensionCounts.set(ext, list);
      }
    }

    // 4. Match technology rules
    const detectedMap = new Map<string, DetectedTechnology>();

    for (const rule of TECH_RULES) {
      const evidence: DNAEvidence[] = [];
      let maxConfidence: DNAConfidence = 'UNKNOWN';
      let version: string | undefined = undefined;

      // Check package names
      if (rule.packageNames) {
        for (const pkg of rule.packageNames) {
          const found = packageDeps.get(pkg);
          if (found) {
            maxConfidence = 'CONFIRMED';
            if (found.version && !version) {
              version = found.version;
            }
            evidence.push({
              kind: 'PACKAGE_DEPENDENCY',
              path: found.filePath,
              detail: `Dependency '${pkg}'${found.version ? ` (${found.version})` : ''} declared in ${found.filePath}`,
              confidence: 'CONFIRMED'
            });
          }
        }
      }

      // Check config files
      if (rule.configFiles) {
        for (const cfg of rule.configFiles) {
          const cfgPath = allPaths.find(
            p => p.toLowerCase() === cfg.toLowerCase() || p.toLowerCase().endsWith('/' + cfg.toLowerCase())
          );
          if (cfgPath) {
            maxConfidence = 'CONFIRMED';
            evidence.push({
              kind: 'CONFIG_FILE',
              path: cfgPath,
              detail: `Configuration file '${cfg}' detected at ${cfgPath}`,
              confidence: 'CONFIRMED'
            });
          }
        }
      }

      // Check AST imports
      if (rule.importModules) {
        for (const mod of rule.importModules) {
          const imps = allImports.get(mod);
          if (imps && imps.length > 0) {
            maxConfidence = 'CONFIRMED';
            const sample = imps[0]!;
            evidence.push({
              kind: 'AST_IMPORT',
              path: sample.filePath,
              line: sample.line,
              detail: `Module '${mod}' imported across ${imps.length} file(s) (first in ${sample.filePath}:${sample.line})`,
              confidence: 'CONFIRMED'
            });
          }
        }
      }

      // Check file extensions (inferential)
      if (rule.fileExtensions) {
        let totalFilesWithExt = 0;
        let sampleFile: string | undefined = undefined;
        for (const ext of rule.fileExtensions) {
          const files = extensionCounts.get(ext);
          if (files && files.length > 0) {
            totalFilesWithExt += files.length;
            if (!sampleFile) {
              sampleFile = files[0];
            }
          }
        }

        if (totalFilesWithExt > 0 && sampleFile) {
          // If we haven't already confirmed by package/config, mark as INFERRED
          if (maxConfidence === 'UNKNOWN') {
            maxConfidence = 'INFERRED';
          }
          evidence.push({
            kind: 'FILE_EXTENSION',
            path: sampleFile,
            detail: `${totalFilesWithExt} file(s) found with extension(s) ${rule.fileExtensions.join(', ')}`,
            confidence: maxConfidence === 'CONFIRMED' ? 'CONFIRMED' : 'INFERRED'
          });
        }
      }

      // If we have evidence, register technology
      if (evidence.length > 0) {
        const sortedEvidence = canonicalSort(evidence, e => `${e.kind}:${e.path}:${e.detail}`);
        detectedMap.set(rule.name, {
          name: rule.name,
          category: rule.category,
          version: version ?? undefined,
          confidence: maxConfidence,
          evidence: sortedEvidence
        });
      }
    }

    // Secondary inference for React from JSX / components if no import was matched
    if (!detectedMap.has('React')) {
      let jsxComponentCount = 0;
      let samplePath = '';
      let sampleLine = 1;
      for (const [p, fa] of Object.entries(fileAnalyses)) {
        for (const s of fa.symbols) {
          if (s.componentClassification === 'COMPONENT_CONFIRMED' || s.componentClassification === 'COMPONENT_INFERRED') {
            jsxComponentCount++;
            if (!samplePath) {
              samplePath = p;
              sampleLine = s.lineStart;
            }
          }
        }
      }
      if (jsxComponentCount > 0 && samplePath) {
        detectedMap.set('React', {
          name: 'React',
          category: 'ui',
          version: undefined,
          confidence: 'INFERRED',
          evidence: [
            {
              kind: 'AST_COMPONENT',
              path: samplePath,
              line: sampleLine,
              detail: `${jsxComponentCount} UI component(s) inferred from JSX/TSX syntax`,
              confidence: 'INFERRED'
            }
          ]
        });
      }
    }

    // Determine Language
    let language: DetectedTechnology;
    if (detectedMap.has('TypeScript')) {
      language = detectedMap.get('TypeScript')!;
    } else if (detectedMap.has('JavaScript')) {
      language = detectedMap.get('JavaScript')!;
    } else {
      language = {
        name: 'unknown',
        category: 'language',
        version: undefined,
        confidence: 'UNKNOWN',
        evidence: []
      };
    }

    // Determine UI Library
    let uiLibrary: DetectedTechnology | undefined = undefined;
    for (const uiName of ['React', 'Vue', 'Svelte', 'Angular']) {
      if (detectedMap.has(uiName)) {
        uiLibrary = detectedMap.get(uiName);
        break;
      }
    }

    // Determine Framework (Fullstack / Backend / Frontend)
    let framework: DetectedTechnology;
    const fwCandidates = ['Next.js', 'Astro', 'Fastify', 'Express', 'NestJS', 'Hono', 'Koa'];
    let selectedFw: DetectedTechnology | undefined = undefined;
    for (const cand of fwCandidates) {
      if (detectedMap.has(cand)) {
        selectedFw = detectedMap.get(cand);
        break;
      }
    }

    if (selectedFw) {
      framework = selectedFw;
    } else if (uiLibrary) {
      // React / Vue acts as the primary UI framework
      framework = {
        ...uiLibrary,
        category: 'framework'
      };
    } else {
      framework = {
        name: 'unknown',
        category: 'framework',
        version: undefined,
        confidence: 'UNKNOWN',
        evidence: []
      };
    }

    // Determine Runtime
    let runtime: DetectedTechnology;
    if (detectedMap.has('Bun')) {
      runtime = detectedMap.get('Bun')!;
    } else if (detectedMap.has('Deno')) {
      runtime = detectedMap.get('Deno')!;
    } else if (detectedMap.has('Node.js') || packageDeps.size > 0 || allPaths.some(p => p.endsWith('.ts') || p.endsWith('.js'))) {
      const nodeEv: DNAEvidence[] = [];
      if (detectedMap.has('Node.js')) {
        nodeEv.push(...detectedMap.get('Node.js')!.evidence);
      }
      if (packageDeps.size > 0) {
        nodeEv.push({
          kind: 'CONFIG_FILE',
          path: 'package.json',
          detail: 'Node.js npm environment detected via package.json',
          confidence: 'CONFIRMED'
        });
      }
      runtime = {
        name: 'Node.js',
        category: 'runtime',
        version: undefined,
        confidence: nodeEv.some(e => e.confidence === 'CONFIRMED') ? 'CONFIRMED' : 'INFERRED',
        evidence: canonicalSort(nodeEv, e => `${e.kind}:${e.path}:${e.detail}`)
      };
    } else {
      runtime = {
        name: 'unknown',
        category: 'runtime',
        version: undefined,
        confidence: 'UNKNOWN',
        evidence: []
      };
    }

    // Determine State Management
    let stateManagement: DetectedTechnology | undefined = undefined;
    for (const sm of ['Redux', 'Zustand', 'Pinia', 'MobX', 'Vuex', 'Recoil']) {
      if (detectedMap.has(sm)) {
        stateManagement = detectedMap.get(sm);
        break;
      }
    }

    // Determine Database / ORM
    let databaseOrOrm: DetectedTechnology | undefined = undefined;
    for (const db of ['Prisma', 'Drizzle', 'TypeORM', 'Mongoose', 'Kysely', 'Sequelize', 'PostgreSQL Driver', 'MySQL Driver']) {
      if (detectedMap.has(db)) {
        databaseOrOrm = detectedMap.get(db);
        break;
      }
    }

    // Determine Test Framework
    let testFramework: DetectedTechnology | undefined = undefined;
    for (const tf of ['Vitest', 'Jest', 'Playwright', 'Cypress', 'node:test']) {
      if (detectedMap.has(tf)) {
        testFramework = detectedMap.get(tf);
        break;
      }
    }

    // Determine Build Tool
    let buildTool: DetectedTechnology | undefined = undefined;
    for (const bt of ['Vite', 'Next.js', 'Webpack', 'Esbuild', 'Rollup', 'Turbopack', 'Tsup']) {
      if (detectedMap.has(bt)) {
        buildTool = detectedMap.get(bt);
        break;
      }
    }

    // Determine Styling
    let styling: DetectedTechnology | undefined = undefined;
    for (const st of ['Tailwind CSS', 'Styled Components', 'Emotion', 'Sass/SCSS']) {
      if (detectedMap.has(st)) {
        styling = detectedMap.get(st);
        break;
      }
    }

    // Additional technologies (all detected minus the primary slot items)
    const primaryNames = new Set([
      language.name,
      framework.name,
      runtime.name,
      uiLibrary?.name,
      stateManagement?.name,
      databaseOrOrm?.name,
      testFramework?.name,
      buildTool?.name,
      styling?.name
    ].filter((n): n is string => Boolean(n) && n !== 'unknown'));

    const additionalTechnologies: DetectedTechnology[] = [];
    for (const [name, tech] of detectedMap.entries()) {
      if (!primaryNames.has(name)) {
        additionalTechnologies.push(tech);
      }
    }

    return {
      language,
      framework,
      runtime,
      uiLibrary: uiLibrary ?? undefined,
      stateManagement: stateManagement ?? undefined,
      databaseOrOrm: databaseOrOrm ?? undefined,
      testFramework: testFramework ?? undefined,
      buildTool: buildTool ?? undefined,
      styling: styling ?? undefined,
      additionalTechnologies: canonicalSort(additionalTechnologies, t => t.name)
    };
  }
}
