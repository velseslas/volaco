/**
 * VibeCode Core - AI-Native Engineering Tier (AINT-007)
 * Tool Definitions & Specifications
 * 12 Standard Tools + Aliases
 */

import type { ToolDefinition } from '../types.js';

export const STANDARD_TOOL_NAMES = [
  'READ_PROJECT',
  'READ_FILE',
  'SEARCH_CODE',
  'ANALYZE_CODE',
  'GET_APPLICATION_DNA',
  'GET_SEMANTIC_GRAPH',
  'ANALYZE_IMPACT',
  'BUILD_MUTATION_PLAN',
  'PREVIEW_MUTATION',
  'EXECUTE_MUTATION',
  'VALIDATE_RESULT',
  'RUN_TESTS'
] as const;

export const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  // 1. READ_PROJECT
  READ_PROJECT: {
    name: 'READ_PROJECT',
    description: 'Lit la structure globale et les métadonnées du projet',
    inputSchema: {
      type: 'object',
      properties: {
        maxFiles: { type: 'number', description: 'Nombre maximum de fichiers à lister' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        projectSummary: { type: 'object' },
        files: { type: 'array' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 5000,
    idempotent: true,
    provenance: 'AINT-001'
  },
  read_project: {
    name: 'read_project',
    description: 'Alias pour READ_PROJECT',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 5000,
    idempotent: true,
    provenance: 'AINT-001'
  },

  // 2. READ_FILE
  READ_FILE: {
    name: 'READ_FILE',
    description: 'Lit le contenu textuel d un fichier du projet',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Chemin relatif du fichier' }
      },
      required: ['path']
    },
    outputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        fileHash: { type: 'string' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 5000,
    idempotent: true,
    provenance: 'AINT-001/FileSource'
  },
  read_file: {
    name: 'read_file',
    description: 'Lit le contenu textuel d un fichier du projet (alias)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Chemin relatif du fichier' }
      },
      required: ['path']
    },
    outputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        fileHash: { type: 'string' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 5000,
    idempotent: true,
    provenance: 'AINT-001/FileSource'
  },

  // 3. SEARCH_CODE
  SEARCH_CODE: {
    name: 'SEARCH_CODE',
    description: 'Recherche une chaîne ou un motif dans les fichiers du projet',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Terme de recherche' },
        filePattern: { type: 'string', description: 'Motif optionnel de filtre de fichier' }
      },
      required: ['query']
    },
    outputSchema: {
      type: 'object',
      properties: {
        matches: { type: 'array' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 8000,
    idempotent: true,
    provenance: 'AINT-001'
  },
  search_code: {
    name: 'search_code',
    description: 'Recherche une chaîne ou un motif dans les fichiers du projet (alias)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Terme de recherche' },
        filePattern: { type: 'string', description: 'Motif optionnel de filtre de fichier' }
      },
      required: ['query']
    },
    outputSchema: {
      type: 'object',
      properties: {
        matches: { type: 'array' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 8000,
    idempotent: true,
    provenance: 'AINT-001'
  },

  // 4. ANALYZE_CODE
  ANALYZE_CODE: {
    name: 'ANALYZE_CODE',
    description: 'Analyse AST et inspection de symboles de code',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        filePath: { type: 'string' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        ast: { type: 'object' },
        symbols: { type: 'array' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 5000,
    idempotent: true,
    provenance: 'AINT-001'
  },
  analyze_code: {
    name: 'analyze_code',
    description: 'Alias pour ANALYZE_CODE',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 5000,
    idempotent: true,
    provenance: 'AINT-001'
  },
  inspect_symbol: {
    name: 'inspect_symbol',
    description: 'Inspecte un symbole AST (fonction, classe, interface, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        filePath: { type: 'string' }
      },
      required: ['symbol']
    },
    outputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'object' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 5000,
    idempotent: true,
    provenance: 'AINT-001'
  },

  // 5. GET_APPLICATION_DNA
  GET_APPLICATION_DNA: {
    name: 'GET_APPLICATION_DNA',
    description: 'Récupère le profil architectural et l ADN applicatif (AINT-002)',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    outputSchema: {
      type: 'object',
      properties: {
        dna: { type: 'object' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 5000,
    idempotent: true,
    provenance: 'AINT-002'
  },
  get_application_dna: {
    name: 'get_application_dna',
    description: 'Alias pour GET_APPLICATION_DNA',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 5000,
    idempotent: true,
    provenance: 'AINT-002'
  },
  inspect_route: {
    name: 'inspect_route',
    description: 'Inspecte une route HTTP / API déclarée dans le projet',
    inputSchema: {
      type: 'object',
      properties: {
        route: { type: 'string' }
      },
      required: ['route']
    },
    outputSchema: {
      type: 'object',
      properties: {
        route: { type: 'object' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 5000,
    idempotent: true,
    provenance: 'AINT-002'
  },

  // 6. GET_SEMANTIC_GRAPH
  GET_SEMANTIC_GRAPH: {
    name: 'GET_SEMANTIC_GRAPH',
    description: 'Interroge le graphe de code sémantique (AINT-004)',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        depth: { type: 'number' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        nodes: { type: 'array' },
        edges: { type: 'array' },
        graphHash: { type: 'string' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 8000,
    idempotent: true,
    provenance: 'AINT-004'
  },
  get_semantic_graph: {
    name: 'get_semantic_graph',
    description: 'Alias pour GET_SEMANTIC_GRAPH',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 8000,
    idempotent: true,
    provenance: 'AINT-004'
  },
  inspect_graph: {
    name: 'inspect_graph',
    description: 'Interroge le graphe de code sémantique pour explorer les dépendances (alias)',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        depth: { type: 'number' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        nodes: { type: 'array' },
        edges: { type: 'array' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 8000,
    idempotent: true,
    provenance: 'AINT-004'
  },

  // 7. ANALYZE_IMPACT
  ANALYZE_IMPACT: {
    name: 'ANALYZE_IMPACT',
    description: 'Analyse l impact et le rayon d explosion avant toute modification (AINT-005)',
    inputSchema: {
      type: 'object',
      properties: {
        targetFiles: { type: 'array' },
        targetSymbols: { type: 'array' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        overallRisk: { type: 'string' },
        affectedFilesCount: { type: 'number' },
        breakingCount: { type: 'number' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 8000,
    idempotent: true,
    provenance: 'AINT-005'
  },
  analyze_impact: {
    name: 'analyze_impact',
    description: 'Analyse l impact et le rayon d explosion avant toute modification (alias)',
    inputSchema: {
      type: 'object',
      properties: {
        targetFiles: { type: 'array' },
        targetSymbols: { type: 'array' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        overallRisk: { type: 'string' },
        affectedFilesCount: { type: 'number' },
        breakingCount: { type: 'number' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 8000,
    idempotent: true,
    provenance: 'AINT-005'
  },

  // 8. BUILD_MUTATION_PLAN
  BUILD_MUTATION_PLAN: {
    name: 'BUILD_MUTATION_PLAN',
    description: 'Construit un plan de mutation atomique conforme au schéma AINT-006',
    inputSchema: {
      type: 'object',
      properties: {
        mutations: { type: 'array' },
        baseGraphHash: { type: 'string' }
      },
      required: ['mutations']
    },
    outputSchema: {
      type: 'object',
      properties: {
        plan: { type: 'object' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 5000,
    idempotent: true,
    provenance: 'AINT-006'
  },
  build_mutation_plan: {
    name: 'build_mutation_plan',
    description: 'Alias pour BUILD_MUTATION_PLAN',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 5000,
    idempotent: true,
    provenance: 'AINT-006'
  },

  // 9. PREVIEW_MUTATION
  PREVIEW_MUTATION: {
    name: 'PREVIEW_MUTATION',
    description: 'Prévisualise les diffs d un plan de mutation sans modifier le disque (dry-run AINT-006)',
    inputSchema: {
      type: 'object',
      properties: {
        plan: { type: 'object' }
      },
      required: ['plan']
    },
    outputSchema: {
      type: 'object',
      properties: {
        diffs: { type: 'array' },
        success: { type: 'boolean' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 10000,
    idempotent: true,
    provenance: 'AINT-006'
  },
  preview_mutation: {
    name: 'preview_mutation',
    description: 'Prévisualise les diffs d un plan de mutation (alias)',
    inputSchema: {
      type: 'object',
      properties: {
        plan: { type: 'object' }
      },
      required: ['plan']
    },
    outputSchema: {
      type: 'object',
      properties: {
        diffs: { type: 'array' },
        success: { type: 'boolean' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 10000,
    idempotent: true,
    provenance: 'AINT-006'
  },

  // 10. EXECUTE_MUTATION
  EXECUTE_MUTATION: {
    name: 'EXECUTE_MUTATION',
    description: 'Exécute un plan de mutation atomique exclusivement via AINT-006',
    inputSchema: {
      type: 'object',
      properties: {
        plan: { type: 'object' }
      },
      required: ['plan']
    },
    outputSchema: {
      type: 'object',
      properties: {
        transactionId: { type: 'string' },
        success: { type: 'boolean' },
        filesModifiedCount: { type: 'number' }
      }
    },
    isReadonly: false,
    readOnly: false,
    risk: 'HIGH',
    riskLevel: 'HIGH',
    permissions: ['PROJECT_MUTATE'],
    requiredPermission: 'PROJECT_MUTATE' as const,
    timeoutMs: 20000,
    idempotent: false,
    provenance: 'AINT-006'
  },
  execute_mutation: {
    name: 'execute_mutation',
    description: 'Exécute un plan de mutation atomique exclusivement via AINT-006 (alias)',
    inputSchema: {
      type: 'object',
      properties: {
        plan: { type: 'object' }
      },
      required: ['plan']
    },
    outputSchema: {
      type: 'object',
      properties: {
        transactionId: { type: 'string' },
        success: { type: 'boolean' },
        filesModifiedCount: { type: 'number' }
      }
    },
    isReadonly: false,
    readOnly: false,
    risk: 'HIGH',
    riskLevel: 'HIGH',
    permissions: ['PROJECT_MUTATE'],
    requiredPermission: 'PROJECT_MUTATE' as const,
    timeoutMs: 20000,
    idempotent: false,
    provenance: 'AINT-006'
  },

  // 11. VALIDATE_RESULT
  VALIDATE_RESULT: {
    name: 'VALIDATE_RESULT',
    description: 'Valide le résultat après mutation (vérification syntaxique, typecheck, lint)',
    inputSchema: {
      type: 'object',
      properties: {
        targetFiles: { type: 'array' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean' },
        errors: { type: 'array' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 15000,
    idempotent: true,
    provenance: 'AINT-007'
  },
  validate_result: {
    name: 'validate_result',
    description: 'Alias pour VALIDATE_RESULT',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 15000,
    idempotent: true,
    provenance: 'AINT-007'
  },

  // 12. RUN_TESTS
  RUN_TESTS: {
    name: 'RUN_TESTS',
    description: 'Exécute les tests unitaires et de régression du projet',
    inputSchema: {
      type: 'object',
      properties: {
        testPattern: { type: 'string' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        passed: { type: 'boolean' },
        testsRun: { type: 'number' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 15000,
    idempotent: true,
    provenance: 'AINT-007'
  },
  run_tests: {
    name: 'run_tests',
    description: 'Exécute les tests unitaires et de régression du projet (alias)',
    inputSchema: {
      type: 'object',
      properties: {
        testPattern: { type: 'string' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        passed: { type: 'boolean' },
        testsRun: { type: 'number' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 15000,
    idempotent: true,
    provenance: 'AINT-007'
  },

  // Complementary tools
  build_context: {
    name: 'build_context',
    description: 'Assemble un pack de contexte ciblé selon un budget de tokens',
    inputSchema: {
      type: 'object',
      properties: {
        userIntent: { type: 'string' },
        focusFiles: { type: 'array' },
        maxTokens: { type: 'number' }
      },
      required: ['userIntent']
    },
    outputSchema: {
      type: 'object',
      properties: {
        assembledTokens: { type: 'number' },
        items: { type: 'array' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 8000,
    idempotent: true,
    provenance: 'AINT-003'
  },

  run_typecheck: {
    name: 'run_typecheck',
    description: 'Exécute la vérification des types TypeScript du projet',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    outputSchema: {
      type: 'object',
      properties: {
        passed: { type: 'boolean' },
        errorCount: { type: 'number' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 15000,
    idempotent: true,
    provenance: 'AINT-007'
  },

  run_build: {
    name: 'run_build',
    description: 'Exécute le build de vérification du projet',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    outputSchema: {
      type: 'object',
      properties: {
        passed: { type: 'boolean' }
      }
    },
    isReadonly: true,
    readOnly: true,
    risk: 'LOW',
    riskLevel: 'LOW',
    permissions: ['PROJECT_READ'],
    requiredPermission: 'PROJECT_READ' as const,
    timeoutMs: 20000,
    idempotent: true,
    provenance: 'AINT-007'
  }
};
